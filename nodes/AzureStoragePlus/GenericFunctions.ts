import { createHmac } from 'crypto';

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
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { Parser } from 'xml2js';
import { firstCharLowerCase, parseBooleans, parseNumbers } from 'xml2js/lib/processors';

const XMS_VERSION = '2021-12-02';

// Canonical blob SAS permission order (matches Azure JS SDK BlobSASPermissions.toString()).
// Letters not in this set are silently dropped.
const BLOB_SAS_PERMISSION_ORDER = 'racwdxtmey';

// User-delegation keys cannot exceed 7 days of validity.
const USER_DELEGATION_KEY_MAX_MS = 7 * 24 * 60 * 60 * 1000;

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

// ---- User Delegation SAS ----

export interface BlobSasOptions {
	permissions: string;
	expiresOn: Date;
	startsOn?: Date;
	cacheControl?: string;
	contentDisposition?: string;
	contentEncoding?: string;
	contentLanguage?: string;
	contentType?: string;
}

export interface BlobSasResult {
	sasUrl: string;
	sasToken: string;
	blobUrl: string;
	container: string;
	blob: string;
	permissions: string;
	startsOn: string | null;
	expiresOn: string;
}

interface UserDelegationKey {
	signedOid: string;
	signedTid: string;
	signedStart: string;
	signedExpiry: string;
	signedService: string;
	signedVersion: string;
	value: string;
}

export async function generateBlobUserDelegationSas(
	this: IExecuteFunctions,
	container: string,
	blob: string,
	options: BlobSasOptions,
): Promise<BlobSasResult> {
	const credentials = (await this.getCredentials(
		'azureBlobStoragePlusApi',
	)) as ICredentialDataDecryptedObject;
	const storageAccountUrl = (credentials.storageAccountUrl as string).replace(/\/$/, '');
	const accountName = extractAccountName.call(this, storageAccountUrl);

	const permissions = canonicalizeBlobPermissions(options.permissions);
	if (!permissions) {
		throw new NodeOperationError(
			this.getNode(),
			'At least one SAS permission must be selected',
		);
	}

	const now = Date.now();
	if (options.expiresOn.getTime() <= now) {
		throw new NodeOperationError(this.getNode(), 'SAS expiry must be in the future');
	}
	if (options.startsOn && options.startsOn.getTime() >= options.expiresOn.getTime()) {
		throw new NodeOperationError(
			this.getNode(),
			'Starts At must be earlier than Expires At',
		);
	}

	// User-delegation key is fetched fresh per request and signed for the SAS lifetime.
	// Start the key a few minutes in the past to absorb client/server clock skew.
	const keyStart = new Date(Math.min(now, options.startsOn?.getTime() ?? now) - 5 * 60 * 1000);

	// Azure requires both Start and Expiry of the user-delegation key to be within
	// 7 days of "now", AND the key's total lifetime (Expiry - Start) to be at most 7 days.
	if (now - keyStart.getTime() > USER_DELEGATION_KEY_MAX_MS) {
		throw new NodeOperationError(
			this.getNode(),
			'Starts At cannot be more than 7 days in the past',
		);
	}
	if (options.expiresOn.getTime() - keyStart.getTime() > USER_DELEGATION_KEY_MAX_MS) {
		throw new NodeOperationError(
			this.getNode(),
			'SAS lifetime cannot exceed 7 days (Azure user-delegation-key limit)',
		);
	}

	const key = await getUserDelegationKey.call(this, keyStart, options.expiresOn);

	const se = toIsoSeconds(options.expiresOn);
	const st = options.startsOn ? toIsoSeconds(options.startsOn) : '';
	const sv = XMS_VERSION;
	const sr = 'b';
	const spr = storageAccountUrl.startsWith('http://') ? 'https,http' : 'https';
	const rscc = options.cacheControl ?? '';
	const rscd = options.contentDisposition ?? '';
	const rsce = options.contentEncoding ?? '';
	const rscl = options.contentLanguage ?? '';
	const rsct = options.contentType ?? '';
	const canonicalizedResource = `/blob/${accountName}/${container}/${blob}`;

	// String-to-sign for sv=2020-12-06 and later (user delegation SAS, blob).
	// Empty positions are: saoid, suoid, scid, sip, snapshot time, encryption scope.
	const stringToSign = [
		permissions,
		st,
		se,
		canonicalizedResource,
		key.signedOid,
		key.signedTid,
		key.signedStart,
		key.signedExpiry,
		key.signedService,
		key.signedVersion,
		'',
		'',
		'',
		'',
		spr,
		sv,
		sr,
		'',
		'',
		rscc,
		rscd,
		rsce,
		rscl,
		rsct,
	].join('\n');

	const signature = createHmac('sha256', Buffer.from(key.value, 'base64'))
		.update(stringToSign, 'utf8')
		.digest('base64');

	// Build the SAS query string with encodeURIComponent (RFC 3986: space => %20).
	// URLSearchParams uses application/x-www-form-urlencoded (space => '+'), which
	// Azure rejects for SAS values that contain spaces (e.g. response-header overrides).
	const sasToken = ([
		['sp', permissions],
		['st', st],
		['se', se],
		['sv', sv],
		['sr', sr],
		['skoid', key.signedOid],
		['sktid', key.signedTid],
		['skt', key.signedStart],
		['ske', key.signedExpiry],
		['sks', key.signedService],
		['skv', key.signedVersion],
		['spr', spr],
		['rscc', rscc],
		['rscd', rscd],
		['rsce', rsce],
		['rscl', rscl],
		['rsct', rsct],
		['sig', signature],
	] as Array<[string, string]>)
		.filter(([, v]) => v !== '')
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join('&');

	const blobPath = blob.split('/').map(encodeURIComponent).join('/');
	const blobUrl = `${storageAccountUrl}/${encodeURIComponent(container)}/${blobPath}`;

	return {
		sasUrl: `${blobUrl}?${sasToken}`,
		sasToken,
		blobUrl,
		container,
		blob,
		permissions,
		startsOn: st || null,
		expiresOn: se,
	};
}

async function getUserDelegationKey(
	this: IExecuteFunctions,
	start: Date,
	expiry: Date,
): Promise<UserDelegationKey> {
	const credentials = (await this.getCredentials(
		'azureBlobStoragePlusApi',
	)) as ICredentialDataDecryptedObject;
	const storageAccountUrl = (credentials.storageAccountUrl as string).replace(/\/$/, '');
	const token = await getAccessToken(this);

	const xmlBody =
		`<?xml version="1.0" encoding="utf-8"?>` +
		`<KeyInfo><Start>${toIsoSeconds(start)}</Start>` +
		`<Expiry>${toIsoSeconds(expiry)}</Expiry></KeyInfo>`;

	try {
		const response = (await this.helpers.httpRequest({
			method: 'POST',
			url: `${storageAccountUrl}/?restype=service&comp=userdelegationkey`,
			headers: {
				Authorization: `Bearer ${token}`,
				'x-ms-date': new Date().toUTCString(),
				'x-ms-version': XMS_VERSION,
				'Content-Type': 'application/xml',
			},
			body: xmlBody,
			json: false,
			returnFullResponse: true,
		})) as { body: string; statusCode: number };

		return await parseUserDelegationKey(response.body);
	} catch (error) {
		const xmlError = (error as { body?: string }).body;
		if (xmlError && typeof xmlError === 'string' && xmlError.includes('<Error>')) {
			const parsed = await parseXmlError(xmlError);
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: parsed.code,
				description: parsed.message,
			});
		}
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

async function parseUserDelegationKey(xml: string): Promise<UserDelegationKey> {
	const parser = new Parser({
		explicitArray: false,
		tagNameProcessors: [firstCharLowerCase],
	});
	const data = (await parser.parseStringPromise(xml)) as {
		userDelegationKey: UserDelegationKey;
	};
	const key = data.userDelegationKey;
	if (!key?.value) {
		throw new Error('Azure did not return a user delegation key');
	}
	return key;
}

export function canonicalizeBlobPermissions(input: string): string {
	const requested = new Set(input.toLowerCase().split(''));
	return BLOB_SAS_PERMISSION_ORDER.split('')
		.filter((p) => requested.has(p))
		.join('');
}

function extractAccountName(
	this: IExecuteFunctions,
	storageAccountUrl: string,
): string {
	let parsed: URL;
	try {
		parsed = new URL(storageAccountUrl);
	} catch {
		throw new NodeOperationError(
			this.getNode(),
			`Invalid Storage Account URL: ${storageAccountUrl}`,
		);
	}

	// Standard Azure host: <account>.blob.core.windows.net,
	// <account>.dfs.core.windows.net, <account>.z<NN>.blob.storage.azure.net, etc.
	const hostLabels = parsed.hostname.split('.');
	if (
		hostLabels.length >= 3 &&
		(hostLabels[1] === 'blob' || hostLabels[1] === 'dfs' || hostLabels[1].startsWith('z'))
	) {
		return hostLabels[0];
	}

	// Path-style (Azurite, custom proxies): http://host:port/<account>[/...]
	const firstPathSegment = parsed.pathname.split('/').filter(Boolean)[0];
	if (firstPathSegment) {
		return firstPathSegment;
	}

	throw new NodeOperationError(
		this.getNode(),
		`Cannot determine storage account name from Storage Account URL: ${storageAccountUrl}`,
		{
			description:
				'Use a standard URL like https://<account>.blob.core.windows.net, or a path-style URL like http://host:port/<account> (for Azurite).',
		},
	);
}

function toIsoSeconds(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
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
