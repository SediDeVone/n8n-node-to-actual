import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  INodePropertyOptions,
} from 'n8n-workflow';

// We import as any to be resilient to API changes of @actual-app/api across versions
// and to avoid hard dependency on its types in this lightweight custom node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const actual: any = require('@actual-app/api');

async function initActual(url: string, password: string) {
  if (actual && typeof actual.init === 'function') {
    await actual.init({ serverURL: url, password });
    return;
  }
  throw new Error('Actual API init method not found');
}

async function shutdownActualSafe() {
  try {
    if (actual && typeof actual.shutdown === 'function') {
      await actual.shutdown();
    }
  } catch {
    // ignore
  }
}

async function listBudgets(url: string, password: string): Promise<Array<{ id: string; name: string }>> {
  await initActual(url, password);
  try {
    if (typeof actual.downloadBudgets === 'function') {
      return await actual.downloadBudgets();
    }
    if (typeof actual.getBudgets === 'function') {
      return await actual.getBudgets();
    }
    if (typeof actual.listBudgets === 'function') {
      return await actual.listBudgets();
    }
    throw new Error('No supported method to list budgets found in @actual-app/api');
  } finally {
    await shutdownActualSafe();
  }
}

async function withBudget<T>(budgetId: string, fn: () => Promise<T>): Promise<T> {
  if (typeof actual.runWithBudget === 'function') {
    return await actual.runWithBudget(budgetId, fn);
  }
  if (typeof actual.openBudget === 'function') {
    await actual.openBudget(budgetId);
    try {
      return await fn();
    } finally {
      // best-effort: many versions close on shutdown
    }
  }
  if (typeof actual.loadBudget === 'function') {
    await actual.loadBudget(budgetId);
    try {
      return await fn();
    } finally {
      // noop
    }
  }
  if (typeof actual.downloadBudget === 'function') {
    await actual.downloadBudget(budgetId);
    try {
      return await fn();
    } finally {
      // noop
    }
  }
  throw new Error('No supported method to select budget found in @actual-app/api');
}

async function listAccounts(url: string, password: string, budgetId: string): Promise<Array<{ id: string; name: string }>> {
  await initActual(url, password);
  try {
    return await withBudget(budgetId, async () => {
      if (typeof actual.getAccounts === 'function') {
        const accounts = await actual.getAccounts();
        // normalize shapes
        return (accounts || []).map((a: any) => ({ id: a.id || a.uuid || a.account_id, name: a.name }));
      }
      // Attempt to read from internal state if available
      const maybeAccounts = actual?.state?.accounts || [];
      return maybeAccounts.map((a: any) => ({ id: a.id, name: a.name }));
    });
  } finally {
    await shutdownActualSafe();
  }
}

function toMilliunits(amount: unknown): number {
  if (typeof amount === 'number') return Math.round(amount * 1000);
  if (typeof amount === 'string') return Math.round(parseFloat(amount) * 1000);
  throw new Error('Amount must be a number or numeric string');
}

export class Actual implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Actual Budget',
    name: 'actual',
    icon: 'file:actual.svg',
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Send transactions to Actual Budget',
    defaults: {
      name: 'Actual Budget',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'actualApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        default: 'createTransaction',
        options: [
          {
            name: 'Create Transaction(s)',
            value: 'createTransaction',
            description: 'Create transaction(s) from input items',
          },
        ],
      },
      {
        displayName: 'Budget',
        name: 'budgetId',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getBudgets',
        },
        default: '',
        required: true,
        description: 'Budget where transactions will be created',
      },
      {
        displayName: 'Account',
        name: 'accountId',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getAccounts',
          loadOptionsDependsOn: ['budgetId'],
        },
        default: '',
        required: true,
        description: 'Account to post the transactions to',
      },
      {
        displayName: 'Field Mapping',
        name: 'mappingNotice',
        type: 'notice',
        default:
          'This node reads the following fields from each input item: date, amount, payee, notes, transaction_id',
      },
    ],
  };

  methods = {
    loadOptions: {
      async getBudgets(this: ILoadOptionsFunctions) {
        const credentials = await this.getCredentials('actualApi');
        const url = (credentials as any).url as string;
        const password = (credentials as any).password as string;
        const budgets = await listBudgets(url, password);
        const options: INodePropertyOptions[] = budgets.map((b) => ({ name: b.name, value: b.id }));
        return options;
      },
      async getAccounts(this: ILoadOptionsFunctions) {
        const credentials = await this.getCredentials('actualApi');
        const url = (credentials as any).url as string;
        const password = (credentials as any).password as string;
        const budgetId = (await this.getCurrentNodeParameter('budgetId')) as string;
        if (!budgetId) return [];
        const accounts = await listAccounts(url, password, budgetId);
        const options: INodePropertyOptions[] = accounts.map((a) => ({ name: a.name, value: a.id }));
        return options;
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = this.getNodeParameter('operation', 0) as string;
    const budgetId = this.getNodeParameter('budgetId', 0) as string;
    const accountId = this.getNodeParameter('accountId', 0) as string;

    const credentials = await this.getCredentials('actualApi');
    const url = (credentials as any).url as string;
    const password = (credentials as any).password as string;

    if (operation !== 'createTransaction') {
      throw new Error(`Unsupported operation: ${operation}`);
    }

    await initActual(url, password);
    try {
      const result = await withBudget(budgetId, async () => {
        const transactions = items.map((item, index) => {
          const json = item.json as Record<string, any>;
          const date = json.date as string;
          const amount = toMilliunits(json.amount);
          const payee = json.payee as string | undefined;
          const notes = json.notes as string | undefined;
          const imported_id = (json.transaction_id as string | number | undefined)?.toString();

          if (!date) {
            throw new Error(`Item ${index}: missing required field "date"`);
          }

          const tx: any = {
            account: accountId,
            date,
            amount,
          };
          if (payee) tx.payee_name = payee;
          if (notes) tx.notes = notes;
          if (imported_id) tx.imported_id = imported_id;

          return tx;
        });

        if (typeof actual.addTransactions !== 'function') {
          throw new Error('addTransactions is not available on @actual-app/api');
        }

        const resp = await actual.addTransactions(transactions);
        return resp;
      });

      const returnData: INodeExecutionData[] = [
        {
          json: {
            success: true,
            created: Array.isArray(result) ? result.length : undefined,
            result,
          },
        },
      ];
      return [returnData];
    } finally {
      await shutdownActualSafe();
    }
  }
}
