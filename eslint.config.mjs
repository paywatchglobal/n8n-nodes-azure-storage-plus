import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

// Marketplace-only rules disabled for this internal-scope package:
// - no-runtime-dependencies: we ship xml2js as a runtime dep (marketplace nodes
//   are expected to bundle, but this package isn't submitted to the marketplace).
// - require-node-api-error: re-throwing an already-wrapped NodeApiError /
//   NodeOperationError after an `instanceof` guard is correct; the rule is
//   purely syntactic and can't see the guard.
export default [
	...configWithoutCloudSupport,
	{
		rules: {
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
			'@n8n/community-nodes/require-node-api-error': 'off',
		},
	},
];
