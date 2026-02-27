import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AzureBlobStoragePlusApi implements ICredentialType {
	name = 'azureBlobStoragePlusApi';

	displayName = 'Azure Blob Storage Plus API';

	icon = { light: 'file:azureStorage.svg', dark: 'file:azureStorage.svg' } as const;

	documentationUrl =
		'https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction';

	properties: INodeProperties[] = [
		{
			displayName: 'Storage Account URL',
			name: 'storageAccountUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. https://myaccount.blob.core.windows.net',
			description: 'The URL of your Azure Blob Storage account',
		},
		{
			displayName: 'Tenant ID',
			name: 'tenantId',
			type: 'string',
			default: '',
			required: true,
			description: 'The Azure AD / Microsoft Entra tenant ID',
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'The Application (client) ID from the app registration',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The client secret from the app registration',
		},
	];
}
