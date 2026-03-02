import type { INodeProperties } from 'n8n-workflow';

export const blobOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['blob'],
			},
		},
		options: [
			{
				name: 'Copy',
				value: 'copy',
				description: 'Copy a blob to a destination (server-side)',
				action: 'Copy blob',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new blob or replace an existing one',
				action: 'Create blob',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a blob',
				action: 'Delete blob',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Download a blob',
				action: 'Get blob',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List blobs in a container',
				action: 'Get many blobs',
			},
			{
				name: 'Get Properties',
				value: 'getProperties',
				description: 'Get blob properties without downloading content',
				action: 'Get blob properties',
			},
			{
				name: 'Set Metadata',
				value: 'setMetadata',
				description: 'Set metadata on a blob',
				action: 'Set blob metadata',
			},
			{
				name: 'Set Tier',
				value: 'setTier',
				description: 'Set the access tier of a blob',
				action: 'Set blob tier',
			},
			{
				name: 'Undelete',
				value: 'undelete',
				description: 'Restore a soft-deleted blob',
				action: 'Undelete blob',
			},
		],
		default: 'getAll',
	},
];

// Shared container field for blob operations
const containerField: INodeProperties = {
	displayName: 'Container',
	name: 'container',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'getContainers',
				searchable: true,
			},
		},
		{
			displayName: 'By Name',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. my-container',
		},
	],
	description: 'The container the blob belongs to',
};

// Shared blob field for operations that target an existing blob
const blobField: INodeProperties = {
	displayName: 'Blob',
	name: 'blob',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'getBlobs',
				searchable: true,
			},
		},
		{
			displayName: 'By Name',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. folder/myfile.pdf',
		},
	],
	description: 'The blob to operate on',
};

export const blobFields: INodeProperties[] = [
	// ========== Create ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['create'] } },
	},
	{
		displayName: 'Blob Name',
		name: 'blobName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['blob'], operation: ['create'] } },
		placeholder: 'e.g. folder/myfile.pdf',
		description: 'The name (path) of the blob to create',
	},
	{
		displayName: 'From',
		name: 'from',
		type: 'options',
		default: 'binary',
		displayOptions: { show: { resource: ['blob'], operation: ['create'] } },
		options: [
			{ name: 'Binary', value: 'binary' },
			{ name: 'URL', value: 'url' },
		],
		description: 'Whether to upload from binary data or copy from a URL',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: {
			show: { resource: ['blob'], operation: ['create'], from: ['binary'] },
		},
		description: 'Name of the binary property containing the file data',
	},
	{
		displayName: 'Source URL',
		name: 'sourceUrl',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { resource: ['blob'], operation: ['create'], from: ['url'] },
		},
		placeholder: 'e.g. https://example.com/file.pdf',
		description: 'URL to copy blob content from',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['blob'], operation: ['create'] } },
		options: [
			{
				displayName: 'Access Tier',
				name: 'accessTier',
				type: 'options',
				options: [
					{ name: 'Hot', value: 'Hot' },
					{ name: 'Cool', value: 'Cool' },
					{ name: 'Cold', value: 'Cold' },
					{ name: 'Archive', value: 'Archive' },
				],
				default: 'Hot',
				description: 'The access tier for the blob',
			},
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'string',
				default: '',
				description: 'The MIME content type of the blob (auto-detected if not specified)',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				options: [
					{
						displayName: 'Metadata',
						name: 'metadataValues',
						values: [
							{ displayName: 'Key', name: 'key', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				options: [
					{
						displayName: 'Tags',
						name: 'tagValues',
						values: [
							{ displayName: 'Key', name: 'key', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
		],
	},

	// ========== Delete ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['delete'] } },
	},
	{
		...blobField,
		displayOptions: { show: { resource: ['blob'], operation: ['delete'] } },
	},

	// ========== Get (Download) ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['get'] } },
	},
	{
		...blobField,
		displayOptions: { show: { resource: ['blob'], operation: ['get'] } },
	},
	{
		displayName: 'Binary Property',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		displayOptions: { show: { resource: ['blob'], operation: ['get'] } },
		description: 'Name of the binary property to write the downloaded file to',
	},

	// ========== Get Many (List) ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['getAll'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['blob'], operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: {
			show: { resource: ['blob'], operation: ['getAll'], returnAll: [false] },
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['blob'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Prefix',
				name: 'prefix',
				type: 'string',
				default: '',
				description: 'Filter results to blobs whose names begin with this prefix',
			},
			{
				displayName: 'Delimiter',
				name: 'delimiter',
				type: 'string',
				default: '',
				description:
					'Delimiter for virtual hierarchy (e.g. "/" to list only blobs at the current level)',
			},
			{
				displayName: 'Name Filter',
				name: 'nameFilter',
				type: 'string',
				default: '',
				placeholder: 'e.g. report or .*report.*\\.pdf$',
				description:
					'Filter blob names. Plain text does a case-insensitive search; regex metacharacters (*, +, ^, $, etc.) activate regex mode. Use with Prefix for best performance.',
			},
			{
				displayName: 'Include',
				name: 'include',
				type: 'multiOptions',
				options: [
					{ name: 'Copy', value: 'copy' },
					{ name: 'Deleted', value: 'deleted' },
					{ name: 'Deleted With Versions', value: 'deletedwithversions' },
					{ name: 'Immutability Policy', value: 'immutabilitypolicy' },
					{ name: 'Legal Hold', value: 'legalhold' },
					{ name: 'Metadata', value: 'metadata' },
					{ name: 'Permissions', value: 'permissions' },
					{ name: 'Snapshots', value: 'snapshots' },
					{ name: 'Tags', value: 'tags' },
					{ name: 'Uncommitted Blobs', value: 'uncommittedblobs' },
					{ name: 'Versions', value: 'versions' },
				],
				default: [],
				description: 'Additional information to include in the listing',
			},
		],
	},

	// ========== Get Properties ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['getProperties'] } },
	},
	{
		...blobField,
		displayOptions: { show: { resource: ['blob'], operation: ['getProperties'] } },
	},

	// ========== Copy ==========
	{
		...containerField,
		displayName: 'Source Container',
		name: 'container',
		displayOptions: { show: { resource: ['blob'], operation: ['copy'] } },
		description: 'The container of the source blob',
	},
	{
		...blobField,
		displayName: 'Source Blob',
		name: 'blob',
		displayOptions: { show: { resource: ['blob'], operation: ['copy'] } },
		description: 'The source blob to copy',
	},
	{
		displayName: 'Destination Container',
		name: 'destContainer',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show: { resource: ['blob'], operation: ['copy'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'getContainers',
					searchable: true,
				},
			},
			{
				displayName: 'By Name',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. my-container',
			},
		],
		description: 'The destination container to copy the blob to',
	},
	{
		displayName: 'Destination Blob Name',
		name: 'destBlobName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: ['blob'], operation: ['copy'] } },
		placeholder: 'e.g. folder/copy-of-file.pdf',
		description: 'The name (path) for the copied blob',
	},

	// ========== Set Tier ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['setTier'] } },
	},
	{
		...blobField,
		displayOptions: { show: { resource: ['blob'], operation: ['setTier'] } },
	},
	{
		displayName: 'Access Tier',
		name: 'accessTier',
		type: 'options',
		options: [
			{ name: 'Hot', value: 'Hot' },
			{ name: 'Cool', value: 'Cool' },
			{ name: 'Cold', value: 'Cold' },
			{ name: 'Archive', value: 'Archive' },
		],
		default: 'Hot',
		required: true,
		displayOptions: { show: { resource: ['blob'], operation: ['setTier'] } },
		description: 'The access tier to set for the blob',
	},

	// ========== Set Metadata ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['setMetadata'] } },
	},
	{
		...blobField,
		displayOptions: { show: { resource: ['blob'], operation: ['setMetadata'] } },
	},
	{
		displayName: 'Metadata',
		name: 'metadata',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		required: true,
		displayOptions: { show: { resource: ['blob'], operation: ['setMetadata'] } },
		options: [
			{
				displayName: 'Metadata',
				name: 'metadataValues',
				values: [
					{ displayName: 'Key', name: 'key', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
		description: 'Key-value metadata pairs to set on the blob',
	},

	// ========== Undelete ==========
	{
		...containerField,
		displayOptions: { show: { resource: ['blob'], operation: ['undelete'] } },
	},
	{
		...blobField,
		displayOptions: { show: { resource: ['blob'], operation: ['undelete'] } },
	},
];
