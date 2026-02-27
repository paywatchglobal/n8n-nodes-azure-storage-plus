import type { INodeProperties } from 'n8n-workflow';

export const containerOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['container'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new container',
				action: 'Create container',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a container',
				action: 'Delete container',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get container properties',
				action: 'Get container',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'List containers',
				action: 'Get many containers',
			},
		],
		default: 'getAll',
	},
];

export const containerFields: INodeProperties[] = [
	// ------ Create ------
	{
		displayName: 'Container Name',
		name: 'containerName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['container'],
				operation: ['create'],
			},
		},
		placeholder: 'e.g. my-container',
		description: 'The name of the container to create',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['container'],
				operation: ['create'],
			},
		},
		options: [
			{
				displayName: 'Access Level',
				name: 'accessLevel',
				type: 'options',
				options: [
					{ name: 'Private', value: 'private' },
					{ name: 'Blob', value: 'blob' },
					{ name: 'Container', value: 'container' },
				],
				default: 'private',
				description: 'The public access level for the container',
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
							{
								displayName: 'Key',
								name: 'key',
								type: 'string',
								default: '',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
		],
	},

	// ------ Delete ------
	{
		displayName: 'Container',
		name: 'container',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: {
			show: {
				resource: ['container'],
				operation: ['delete'],
			},
		},
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
		description: 'The container to delete',
	},

	// ------ Get ------
	{
		displayName: 'Container',
		name: 'container',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: {
			show: {
				resource: ['container'],
				operation: ['get'],
			},
		},
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
		description: 'The container to get properties for',
	},

	// ------ Get Many ------
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['container'],
				operation: ['getAll'],
			},
		},
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: {
			show: {
				resource: ['container'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
		description: 'Max number of results to return',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['container'],
				operation: ['getAll'],
			},
		},
		options: [
			{
				displayName: 'Prefix',
				name: 'prefix',
				type: 'string',
				default: '',
				description: 'Filter results to containers whose names begin with this prefix',
			},
		],
	},
];
