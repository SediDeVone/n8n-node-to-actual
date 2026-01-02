import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class ActualApi implements ICredentialType {
  name = 'actualApi';
  displayName = 'Actual API';
  documentationUrl = 'https://actualbudget.org/docs/';

  properties: INodeProperties[] = [
    {
      displayName: 'Server URL',
      name: 'url',
      type: 'string',
      default: '',
      placeholder: 'https://your-actual-server/api',
      description: 'Actual server API URL (e.g. https://host:port/api)'
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Server password or encryption key for Actual API'
    }
  ];
}
