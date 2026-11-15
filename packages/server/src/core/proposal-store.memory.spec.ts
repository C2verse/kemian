import { describe } from '@effect/vitest';

import { testProposalStoreContract } from '../../test/proposal-store-contract.ts';
import { memoryProposalStore } from './proposal-store.memory.ts';

describe('memoryProposalStore', () => {
  testProposalStoreContract(memoryProposalStore);
});
