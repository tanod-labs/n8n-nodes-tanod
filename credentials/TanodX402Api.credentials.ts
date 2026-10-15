import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class TanodX402Api implements ICredentialType {
	name = 'tanodX402Api';

	displayName = 'Tanod x402 wallet';

	documentationUrl = 'https://tanod.dev/connect/';

	properties: INodeProperties[] = [
		{
			displayName: 'EVM Private Key',
			name: 'privateKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: '0x...',
			description:
				'Private key of a dedicated wallet holding a small amount of USDC on Base. Used only to sign x402 payments when the free daily allowance is used up. Use a throwaway wallet, never your main one.',
		},
	];
}
