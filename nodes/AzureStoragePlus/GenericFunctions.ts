import type {
	ICredentialDataDecryptedObject,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodeParameterResourceLocator,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { Parser } from 'xml2js';
import { firstCharLowerCase, parseBooleans, parseNumbers } from 'xml2js/lib/processors';

const XMS_VERSION = '2021-12-02';

// Token cache - avoids re-fetching on every API call within the same execution
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(
	context: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<string> {
	// Return cached token if still valid (with 5-minute buffer)
	if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
		return cachedToken.token;
	}

	const credentials =
		(await context.getCredentials('azureBlobStoragePlusApi')) as ICredentialDataDecryptedObject;
	const { tenantId, clientId, clientSecret } = credentials as {
		tenantId: string;
		clientId: string;
		clientSecret: string;
	};

	const body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: clientId,
		client_secret: clientSecret,
		scope: 'https://storage.azure.com/.default',
	}).toString();

	const response = (await context.helpers.httpRequest({
		method: 'POST',
		url: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	})) as { access_token: string; expires_in: number };

	cachedToken = {
		token: response.access_token,
		expiresAt: Date.now() + response.expires_in * 1000,
	};

	return response.access_token;
}

export async function azureStorageApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: Buffer | string | IDataObject,
	qs: IDataObject = {},
	headers: IDataObject = {},
	encoding?: 'arraybuffer' | null,
): Promise<{ body: string | Buffer; headers: IDataObject; statusCode: number }> {
	const credentials =
		(await this.getCredentials('azureBlobStoragePlusApi')) as ICredentialDataDecryptedObject;
	const storageAccountUrl = (credentials.storageAccountUrl as string).replace(/\/$/, '');
	const token = await getAccessToken(this);

	const options: IHttpRequestOptions = {
		method,
		url: `${storageAccountUrl}${endpoint}`,
		headers: {
			Authorization: `Bearer ${token}`,
			'x-ms-date': new Date().toUTCString(),
			'x-ms-version': XMS_VERSION,
			...headers,
		},
		qs,
		returnFullResponse: true,
	};

	if (encoding === 'arraybuffer') {
		options.encoding = 'arraybuffer';
		options.json = false;
	}

	if (body !== undefined && body !== null) {
		options.body = body;
	}

	try {
		const response = (await this.helpers.httpRequest(options)) as {
			body: string | Buffer;
			headers: IDataObject;
			statusCode: number;
		};
		return response;
	} catch (error) {
		const xmlBody = (error as { body?: string }).body;
		if (xmlBody && typeof xmlBody === 'string' && xmlBody.includes('<Error>')) {
			const parsed = await parseXmlError(xmlBody);
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: parsed.code,
				description: parsed.message,
			});
		}
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

export async function azureStorageApiRequestAllItems(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	endpoint: string,
	qs: IDataObject,
	parseFunction: (xml: string) => Promise<{ items: IDataObject[]; nextMarker?: string }>,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let nextMarker: string | undefined;

	do {
		if (nextMarker) {
			qs.marker = nextMarker;
		}

		const response = await azureStorageApiRequest.call(this, 'GET', endpoint, undefined, qs);
		const parsed = await parseFunction(response.body as string);
		results.push(...parsed.items);
		nextMarker = parsed.nextMarker;
	} while (nextMarker);

	return results;
}

// ---- XML Parsers ----

export async function parseBlobList(
	xml: string,
): Promise<{ blobs: IDataObject[]; nextMarker?: string }> {
	const parser = new Parser({
		explicitArray: false,
		tagNameProcessors: [firstCharLowerCase, (name: string) => name.replace('-', '')],
		valueProcessors: [
			function (value: string, name: string) {
				if (
					[
						'deleted',
						'isCurrentVersion',
						'serverEncrypted',
						'incrementalCopy',
						'accessTierInferred',
						'isSealed',
						'legalHold',
					].includes(name)
				) {
					return parseBooleans(value);
				} else if (
					[
						'maxResults',
						'contentLength',
						'blobSequenceNumber',
						'remainingRetentionDays',
						'tagCount',
						'content-Length',
					].includes(name)
				) {
					return parseNumbers(value);
				}
				return value;
			},
		],
	});

	const data = (await parser.parseStringPromise(xml)) as {
		enumerationResults: {
			blobs: { blob: IDataObject | IDataObject[] };
			nextMarker: string;
		};
	};

	if (typeof data.enumerationResults.blobs !== 'object') {
		return { blobs: [] };
	}

	if (!Array.isArray(data.enumerationResults.blobs.blob)) {
		data.enumerationResults.blobs.blob = [data.enumerationResults.blobs.blob];
	}

	for (const blob of data.enumerationResults.blobs.blob) {
		if (blob.tags) {
			if (!Array.isArray(((blob.tags as IDataObject).tagSet as IDataObject).tag)) {
				((blob.tags as IDataObject).tagSet as IDataObject).tag = [
					((blob.tags as IDataObject).tagSet as IDataObject).tag,
				];
			}
			blob.tags = ((blob.tags as IDataObject).tagSet as IDataObject).tag;
		}
		if (blob.metadata === '') {
			delete blob.metadata;
		}
		if (blob.orMetadata === '') {
			delete blob.orMetadata;
		}
	}

	return {
		blobs: data.enumerationResults.blobs.blob,
		nextMarker: data.enumerationResults.nextMarker || undefined,
	};
}

export async function parseContainerList(
	xml: string,
): Promise<{ containers: IDataObject[]; nextMarker?: string }> {
	const parser = new Parser({
		explicitArray: false,
		tagNameProcessors: [firstCharLowerCase, (name: string) => name.replace('-', '')],
		valueProcessors: [
			function (value: string, name: string) {
				if (
					[
						'deleted',
						'hasImmutabilityPolicy',
						'hasLegalHold',
						'preventEncryptionScopeOverride',
						'isImmutableStorageWithVersioningEnabled',
					].includes(name)
				) {
					return parseBooleans(value);
				} else if (['maxResults', 'remainingRetentionDays'].includes(name)) {
					return parseNumbers(value);
				}
				return value;
			},
		],
	});

	const data = (await parser.parseStringPromise(xml)) as {
		enumerationResults: {
			containers: { container: IDataObject | IDataObject[] };
			nextMarker: string;
		};
	};

	if (typeof data.enumerationResults.containers !== 'object') {
		return { containers: [] };
	}

	if (!Array.isArray(data.enumerationResults.containers.container)) {
		data.enumerationResults.containers.container = [
			data.enumerationResults.containers.container,
		];
	}

	for (const container of data.enumerationResults.containers.container) {
		if (container.metadata === '') {
			delete container.metadata;
		}
	}

	return {
		containers: data.enumerationResults.containers.container,
		nextMarker: data.enumerationResults.nextMarker || undefined,
	};
}

export function parseHeaders(headers: IDataObject): IDataObject {
	const parseBooleanHeaders = [
		'x-ms-delete-type-permanent',
		'x-ms-incremental-copy',
		'x-ms-server-encrypted',
		'x-ms-blob-sealed',
		'x-ms-request-server-encrypted',
		'x-ms-has-immutability-policy',
		'x-ms-has-legal-hold',
	];
	const parseNumberHeaders = [
		'x-ms-tag-count',
		'content-length',
		'x-ms-blob-sequence-number',
		'x-ms-copy-progress',
		'x-ms-blob-committed-block-count',
	];

	const result: IDataObject = {};

	const metadataKeys = Object.keys(headers).filter((x) => x.startsWith('x-ms-meta-'));

	for (const key in headers) {
		if (metadataKeys.includes(key)) {
			continue;
		}

		let newKey = key.startsWith('x-ms-')
			? camelCase(key.replace('x-ms-', ''))
			: camelCase(key);
		newKey = newKey.replace('-', '');

		const newValue = parseBooleanHeaders.includes(key)
			? parseBooleans(headers[key] as string)
			: parseNumberHeaders.includes(key)
				? parseNumbers(headers[key] as string)
				: headers[key];

		result[newKey] = newValue;
	}

	if (metadataKeys.length > 0) {
		result.metadata = {};
		for (const key of metadataKeys) {
			(result.metadata as IDataObject)[key.replace('x-ms-meta-', '')] = headers[key];
		}
	}

	return result;
}

export async function parseXmlError(
	xml: string,
): Promise<{ code: string; message: string }> {
	const parser = new Parser({
		explicitArray: false,
		tagNameProcessors: [firstCharLowerCase],
	});

	try {
		const data = (await parser.parseStringPromise(xml)) as {
			error: { code: string; message: string };
		};
		return {
			code: data.error?.code || 'UnknownError',
			message: data.error?.message || xml,
		};
	} catch {
		return { code: 'UnknownError', message: xml };
	}
}

export function buildMetadataHeaders(metadata: IDataObject): IDataObject {
	const headers: IDataObject = {};
	for (const [key, value] of Object.entries(metadata)) {
		headers[`x-ms-meta-${key}`] = value;
	}
	return headers;
}

export function buildTagsQueryString(tags: IDataObject): string {
	return Object.entries(tags)
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
		.join('&');
}

function camelCase(str: string): string {
	return str.replace(/[-_]+(.)?/g, (_, c: string | undefined) =>
		c ? c.toUpperCase() : '',
	);
}

export function resolveResourceLocator(
	param: INodeParameterResourceLocator | string,
): string {
	if (typeof param === 'string') {
		return param;
	}
	return param.value as string;
}

// ---- List Search Methods ----

export async function getContainers(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const qs: IDataObject = {
		comp: 'list',
	};

	if (paginationToken) {
		qs.marker = paginationToken;
	} else {
		qs.maxresults = 5000;
		if (filter) {
			qs.prefix = filter;
		}
	}

	const response = await azureStorageApiRequest.call(this, 'GET', '/', undefined, qs);
	const data = await parseContainerList(response.body as string);

	const results: INodeListSearchItems[] = data.containers
		.map((c) => ({
			name: c.name as string,
			value: c.name as string,
		}))
		.sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
		);

	return {
		results,
		paginationToken: data.nextMarker,
	};
}

export async function getBlobs(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const container = this.getNodeParameter('container') as INodeParameterResourceLocator;

	const qs: IDataObject = {
		restype: 'container',
		comp: 'list',
	};

	if (paginationToken) {
		qs.marker = paginationToken;
	} else {
		qs.maxresults = 5000;
		if (filter) {
			qs.prefix = filter;
		}
	}

	const response = await azureStorageApiRequest.call(
		this,
		'GET',
		`/${resolveResourceLocator(container)}`,
		undefined,
		qs,
	);
	const data = await parseBlobList(response.body as string);

	const results: INodeListSearchItems[] = data.blobs
		.map((c) => ({
			name: c.name as string,
			value: c.name as string,
		}))
		.sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
		);

	return {
		results,
		paginationToken: data.nextMarker,
	};
}
