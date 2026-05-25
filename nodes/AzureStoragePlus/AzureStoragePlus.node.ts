import type {
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	azureStorageApiRequest,
	azureStorageApiRequestAllItems,
	buildMetadataHeaders,
	buildTagsQueryString,
	generateBlobUserDelegationSas,
	getBlobs,
	getContainers,
	parseBlobList,
	parseContainerList,
	parseHeaders,
	resolveResourceLocator,
} from './GenericFunctions';
import {
	blobFields,
	blobOperations,
	containerFields,
	containerOperations,
} from './descriptions';

export class AzureStoragePlus implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Azure Storage Plus',
		name: 'azureStoragePlus',
		icon: 'file:azureStorage.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Interact with Azure Blob Storage using service principal authentication',
		defaults: {
			name: 'Azure Storage Plus',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'azureBlobStoragePlusApi',
				required: true,
				testedBy: 'azureBlobStoragePlusApiTest',
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Blob', value: 'blob' },
					{ name: 'Container', value: 'container' },
				],
				default: 'blob',
			},
			...blobOperations,
			...blobFields,
			...containerOperations,
			...containerFields,
		],
	};

	methods = {
		credentialTest: {
			async azureBlobStoragePlusApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const credentials =
					credential.data as ICredentialDataDecryptedObject;
				const { tenantId, clientId, clientSecret, storageAccountUrl } =
					credentials as {
						tenantId: string;
						clientId: string;
						clientSecret: string;
						storageAccountUrl: string;
					};

				try {
					const body = new URLSearchParams({
						grant_type: 'client_credentials',
						client_id: clientId,
						client_secret: clientSecret,
						scope: 'https://storage.azure.com/.default',
					}).toString();

					// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
					const tokenResponse = (await this.helpers.request({
						method: 'POST',
						uri: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body,
					})) as string;

					const { access_token } = JSON.parse(tokenResponse) as {
						access_token: string;
					};

					const baseUrl = storageAccountUrl.replace(/\/$/, '');
					// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
					await this.helpers.request({
						method: 'GET',
						uri: `${baseUrl}/?comp=list&maxresults=1`,
						headers: {
							Authorization: `Bearer ${access_token}`,
							'x-ms-date': new Date().toUTCString(),
							'x-ms-version': '2021-12-02',
						},
					});

					return {
						status: 'OK',
						message: 'Connection successful',
					};
				} catch (error) {
					return {
						status: 'Error',
						message: `Connection failed: ${(error as Error).message}`,
					};
				}
			},
		},
		listSearch: {
			getContainers,
			getBlobs,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'container') {
					if (operation === 'create') {
						await executeContainerCreate.call(this, i, returnData);
					} else if (operation === 'delete') {
						await executeContainerDelete.call(this, i, returnData);
					} else if (operation === 'get') {
						await executeContainerGet.call(this, i, returnData);
					} else if (operation === 'getAll') {
						await executeContainerGetAll.call(this, i, returnData);
					}
				} else if (resource === 'blob') {
					if (operation === 'create') {
						await executeBlobCreate.call(this, i, returnData);
					} else if (operation === 'delete') {
						await executeBlobDelete.call(this, i, returnData);
					} else if (operation === 'get') {
						await executeBlobGet.call(this, i, returnData);
					} else if (operation === 'getAll') {
						await executeBlobGetAll.call(this, i, returnData);
					} else if (operation === 'getProperties') {
						await executeBlobGetProperties.call(this, i, returnData);
					} else if (operation === 'generateSasUrl') {
						await executeBlobGenerateSasUrl.call(this, i, returnData);
					} else if (operation === 'copy') {
						await executeBlobCopy.call(this, i, returnData);
					} else if (operation === 'setTier') {
						await executeBlobSetTier.call(this, i, returnData);
					} else if (operation === 'setMetadata') {
						await executeBlobSetMetadata.call(this, i, returnData);
					} else if (operation === 'undelete') {
						await executeBlobUndelete.call(this, i, returnData);
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

// =========== Container Operations ===========

async function executeContainerCreate(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const containerName = this.getNodeParameter('containerName', i) as string;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const headers: IDataObject = {};

	if (options.accessLevel && options.accessLevel !== 'private') {
		headers['x-ms-blob-public-access'] = options.accessLevel;
	}

	if (options.metadata) {
		const metadataEntries = (
			(options.metadata as IDataObject).metadataValues as Array<{
				key: string;
				value: string;
			}>
		) || [];
		for (const entry of metadataEntries) {
			if (entry.key) {
				headers[`x-ms-meta-${entry.key}`] = entry.value;
			}
		}
	}

	const response = await azureStorageApiRequest.call(
		this,
		'PUT',
		`/${containerName}?restype=container`,
		undefined,
		{},
		headers,
	);

	returnData.push({
		json: {
			name: containerName,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}

async function executeContainerDelete(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);

	const response = await azureStorageApiRequest.call(
		this,
		'DELETE',
		`/${container}?restype=container`,
	);

	returnData.push({
		json: { success: true, container, ...parseHeaders(response.headers) },
		pairedItem: { item: i },
	});
}

async function executeContainerGet(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);

	const response = await azureStorageApiRequest.call(
		this,
		'GET',
		`/${container}?restype=container`,
	);

	returnData.push({
		json: {
			name: container,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}

async function executeContainerGetAll(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const qs: IDataObject = { comp: 'list' };

	if (options.prefix) {
		qs.prefix = options.prefix;
	}

	if (returnAll) {
		const containers = await azureStorageApiRequestAllItems.call(
			this,
			'/',
			qs,
			async (xml: string) => {
				const parsed = await parseContainerList(xml);
				return { items: parsed.containers, nextMarker: parsed.nextMarker };
			},
		);
		for (const container of containers) {
			returnData.push({ json: container, pairedItem: { item: i } });
		}
	} else {
		const limit = this.getNodeParameter('limit', i) as number;
		qs.maxresults = limit;

		const response = await azureStorageApiRequest.call(
			this,
			'GET',
			'/',
			undefined,
			qs,
		);
		const parsed = await parseContainerList(response.body as string);

		for (const container of parsed.containers) {
			returnData.push({ json: container, pairedItem: { item: i } });
		}
	}
}

// =========== Blob Operations ===========

async function executeBlobCreate(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blobName = this.getNodeParameter('blobName', i) as string;
	const from = this.getNodeParameter('from', i) as string;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const headers: IDataObject = {
		'x-ms-blob-type': 'BlockBlob',
	};

	if (options.accessTier) {
		headers['x-ms-access-tier'] = options.accessTier;
	}

	if (options.metadata) {
		const metadataEntries = (
			(options.metadata as IDataObject).metadataValues as Array<{
				key: string;
				value: string;
			}>
		) || [];
		for (const entry of metadataEntries) {
			if (entry.key) {
				headers[`x-ms-meta-${entry.key}`] = entry.value;
			}
		}
	}

	if (options.tags) {
		const tagEntries = (
			(options.tags as IDataObject).tagValues as Array<{
				key: string;
				value: string;
			}>
		) || [];
		if (tagEntries.length > 0) {
			const tagsObj: IDataObject = {};
			for (const entry of tagEntries) {
				if (entry.key) {
					tagsObj[entry.key] = entry.value;
				}
			}
			headers['x-ms-tags'] = buildTagsQueryString(tagsObj);
		}
	}

	let body: Buffer | undefined;

	if (from === 'binary') {
		const binaryPropertyName = this.getNodeParameter(
			'binaryPropertyName',
			i,
		) as string;
		const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
		body = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

		if (options.contentType) {
			headers['Content-Type'] = options.contentType;
		} else if (binaryData.mimeType) {
			headers['Content-Type'] = binaryData.mimeType;
		} else {
			headers['Content-Type'] = 'application/octet-stream';
		}
	} else {
		const sourceUrl = this.getNodeParameter('sourceUrl', i) as string;
		headers['x-ms-copy-source'] = sourceUrl;
		headers['Content-Length'] = '0';
	}

	const response = await azureStorageApiRequest.call(
		this,
		'PUT',
		`/${container}/${blobName}`,
		body,
		{},
		headers,
	);

	returnData.push({
		json: {
			container,
			name: blobName,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}

async function executeBlobDelete(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blob = resolveResourceLocator(
		this.getNodeParameter('blob', i) as string,
	);

	const response = await azureStorageApiRequest.call(
		this,
		'DELETE',
		`/${container}/${blob}`,
	);

	returnData.push({
		json: { success: true, container, blob, ...parseHeaders(response.headers) },
		pairedItem: { item: i },
	});
}

async function executeBlobGet(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blob = resolveResourceLocator(
		this.getNodeParameter('blob', i) as string,
	);
	const binaryPropertyName = this.getNodeParameter(
		'binaryPropertyName',
		i,
	) as string;

	const response = await azureStorageApiRequest.call(
		this,
		'GET',
		`/${container}/${blob}`,
		undefined,
		{},
		{},
		'arraybuffer',
	);

	const headerData = parseHeaders(response.headers);
	const binaryData = await this.helpers.prepareBinaryData(
		response.body as Buffer,
		blob,
		headerData.contentType as string,
	);

	returnData.push({
		json: {
			container,
			name: blob,
			...headerData,
		},
		binary: { [binaryPropertyName]: binaryData },
		pairedItem: { item: i },
	});
}

async function executeBlobGetAll(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const returnAll = this.getNodeParameter('returnAll', i) as boolean;
	const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const qs: IDataObject = {
		restype: 'container',
		comp: 'list',
	};

	if (options.prefix) {
		qs.prefix = options.prefix;
	}

	if (options.delimiter) {
		qs.delimiter = options.delimiter;
	}

	if (options.include && (options.include as string[]).length > 0) {
		qs.include = (options.include as string[]).join(',');
	}

	const nameFilter = options.nameFilter as string | undefined;
	const nameMatchFn = nameFilter ? buildNameMatchFn(nameFilter) : null;

	// Stream page-by-page: filter each page immediately, early-exit when limit reached
	let collected = 0;
	let nextMarker: string | undefined;

	do {
		if (nextMarker) {
			qs.marker = nextMarker;
		}

		const response = await azureStorageApiRequest.call(
			this,
			'GET',
			`/${container}`,
			undefined,
			qs,
		);
		const parsed = await parseBlobList(response.body as string);

		for (const blob of parsed.blobs) {
			if (nameMatchFn && !nameMatchFn(blob.name as string)) {
				continue;
			}

			returnData.push({ json: blob, pairedItem: { item: i } });
			collected++;

			if (!returnAll && collected >= limit) {
				return;
			}
		}

		nextMarker = parsed.nextMarker;
	} while (nextMarker);
}

const REGEX_METACHARACTERS = /[\\*+?^${}()[\]|]/;

function buildNameMatchFn(filter: string): (name: string) => boolean {
	if (REGEX_METACHARACTERS.test(filter)) {
		// Contains regex syntax - use as regex
		const regex = new RegExp(filter);
		return (name) => regex.test(name);
	}
	// Plain text - case-insensitive substring search
	const lower = filter.toLowerCase();
	return (name) => name.toLowerCase().includes(lower);
}

async function executeBlobGetProperties(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blob = resolveResourceLocator(
		this.getNodeParameter('blob', i) as string,
	);

	const response = await azureStorageApiRequest.call(
		this,
		'HEAD',
		`/${container}/${blob}`,
	);

	returnData.push({
		json: {
			container,
			name: blob,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}

async function executeBlobCopy(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const credentials =
		(await this.getCredentials(
			'azureBlobStoragePlusApi',
		)) as ICredentialDataDecryptedObject;
	const storageAccountUrl = (credentials.storageAccountUrl as string).replace(
		/\/$/,
		'',
	);

	const sourceContainer = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const sourceBlob = resolveResourceLocator(
		this.getNodeParameter('blob', i) as string,
	);
	const destContainer = resolveResourceLocator(
		this.getNodeParameter('destContainer', i) as string,
	);
	const destBlobName = this.getNodeParameter('destBlobName', i) as string;

	const sourceUrl = `${storageAccountUrl}/${sourceContainer}/${sourceBlob}`;

	const response = await azureStorageApiRequest.call(
		this,
		'PUT',
		`/${destContainer}/${destBlobName}`,
		undefined,
		{},
		{
			'x-ms-copy-source': sourceUrl,
		},
	);

	returnData.push({
		json: {
			sourceContainer,
			sourceBlob,
			destContainer,
			destBlob: destBlobName,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}

async function executeBlobSetTier(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blob = resolveResourceLocator(
		this.getNodeParameter('blob', i) as string,
	);
	const accessTier = this.getNodeParameter('accessTier', i) as string;

	const response = await azureStorageApiRequest.call(
		this,
		'PUT',
		`/${container}/${blob}`,
		undefined,
		{ comp: 'tier' },
		{ 'x-ms-access-tier': accessTier },
	);

	returnData.push({
		json: {
			success: true,
			container,
			blob,
			accessTier,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}

async function executeBlobSetMetadata(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blob = resolveResourceLocator(
		this.getNodeParameter('blob', i) as string,
	);
	const metadataParam = this.getNodeParameter('metadata', i) as IDataObject;
	const metadataEntries = (
		metadataParam.metadataValues as Array<{ key: string; value: string }>
	) || [];

	const metadataObj: IDataObject = {};
	for (const entry of metadataEntries) {
		if (entry.key) {
			metadataObj[entry.key] = entry.value;
		}
	}

	const headers = buildMetadataHeaders(metadataObj);

	const response = await azureStorageApiRequest.call(
		this,
		'PUT',
		`/${container}/${blob}`,
		undefined,
		{ comp: 'metadata' },
		headers,
	);

	returnData.push({
		json: {
			success: true,
			container,
			blob,
			metadata: metadataObj,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}

async function executeBlobGenerateSasUrl(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blob = resolveResourceLocator(this.getNodeParameter('blob', i) as string);
	const validityDuration = this.getNodeParameter('validityDuration', i) as number;
	const validityUnit = this.getNodeParameter('validityUnit', i) as string;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const UNIT_MS: Record<string, number> = {
		minutes: 60_000,
		hours: 3_600_000,
		days: 86_400_000,
	};
	const unitMs = UNIT_MS[validityUnit];
	if (unitMs === undefined) {
		throw new NodeOperationError(
			this.getNode(),
			`Unsupported Validity Unit: ${validityUnit}`,
			{ itemIndex: i },
		);
	}

	const startsOn = parseOptionalDate.call(this, options.startsAt, 'Starts At', i);
	const expiresAtOverride = parseOptionalDate.call(
		this,
		options.expiresAt,
		'Expires At',
		i,
	);

	const baseTime = startsOn?.getTime() ?? Date.now();
	const expiresOn =
		expiresAtOverride ?? new Date(baseTime + validityDuration * unitMs);

	const permissionsArr = (options.permissions as string[] | undefined) ?? [];
	const permissions = permissionsArr.length > 0 ? permissionsArr.join('') : 'r';

	const result = await generateBlobUserDelegationSas.call(this, container, blob, {
		permissions,
		expiresOn,
		startsOn,
		cacheControl: options.cacheControl as string | undefined,
		contentDisposition: options.contentDisposition as string | undefined,
		contentEncoding: options.contentEncoding as string | undefined,
		contentLanguage: options.contentLanguage as string | undefined,
		contentType: options.contentType as string | undefined,
	});

	returnData.push({
		json: { ...result },
		pairedItem: { item: i },
	});
}

function parseOptionalDate(
	this: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): Date | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const date = new Date(value as string);
	if (Number.isNaN(date.getTime())) {
		throw new NodeOperationError(
			this.getNode(),
			`Invalid ${fieldName}: ${String(value)}`,
			{ itemIndex },
		);
	}
	return date;
}

async function executeBlobUndelete(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
) {
	const container = resolveResourceLocator(
		this.getNodeParameter('container', i) as string,
	);
	const blob = resolveResourceLocator(
		this.getNodeParameter('blob', i) as string,
	);

	const response = await azureStorageApiRequest.call(
		this,
		'PUT',
		`/${container}/${blob}`,
		undefined,
		{ comp: 'undelete' },
	);

	returnData.push({
		json: {
			success: true,
			container,
			blob,
			...parseHeaders(response.headers),
		},
		pairedItem: { item: i },
	});
}
