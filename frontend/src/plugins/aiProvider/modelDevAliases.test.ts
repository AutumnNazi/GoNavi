import { describe, expect, it } from 'vitest';
import { aliasForModelId, indexModelDevCatalog, modelOptionLabel } from './modelDevAliases';

const catalog = {
  deepseek: {
    models: {
      'deepseek-v4-pro': { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', canonical_model_id: 'deepseek/deepseek-v4-pro' },
      'deepseek-flash': { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', canonical_model_id: 'deepseek/deepseek-v4.1-flash' },
    },
  },
};

describe('modelDevAliases', () => {
  it('maps provider ids and canonical tails to the models.dev name', () => {
    const index = indexModelDevCatalog(catalog);
    expect(aliasForModelId(index, 'deepseek-v4-pro')).toBe('DeepSeek V4 Pro');
    expect(aliasForModelId(index, 'deepseek/deepseek-v4.1-flash')).toBe('DeepSeek V4.1 Flash');
    expect(modelOptionLabel(index, 'missing', 'Plugin Name')).toBe('Plugin Name');
    expect(modelOptionLabel(index, 'missing')).toBe('missing');
  });
});
