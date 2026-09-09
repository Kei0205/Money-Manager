export type RecordType = 
  | 'expense_normal'
  | 'income_normal'
  | 'advance_payment'
  | 'advance_recovery'
  | 'trip_sandbox'
  | 'trip_sandbox_settled'
  | 'trip_reconcile'
  | 'income_allowance'
  | 'income_special'
  | 'refund';

export interface Transaction {
  id?: string;
  description: string;
  date: string;          // "YYYY/MM/DD"
  category: string;
  expense: number;
  income: number;
  balance: number;
  month: string;         // "YYYY-MM"
  recordType: RecordType;
  reconciled?: boolean;
  isRecovered?: boolean;
  originalIndex?: number; // Used during processing on frontend
  index?: number;         // Used during processing on frontend
  cents?: number;         // Used during processing on frontend
}

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
}

export interface MonthlySettings {
  fixedExpenses: FixedExpense[];
  savingsGoal: number;
}

export interface WishlistItem {
  id: string;
  name: string;
  amount: number;
  category: string;
  isApplied: boolean;
  aiAdvice?: string;
  isLoadingAdvice?: boolean;
}

export interface AccountBalance {
  id: string;
  name: string;
  balance?: number;
  total?: number;
  past?: number;
  planned?: number;
}

export interface ExpenseData {
  name: string;
  value: number;
}

export interface CategoryBudget {
  category: string;
  name?: string;
  budget: number;
  spent: number;
  remaining?: number;
  transferredIn?: number;
}

export interface MonthlyData {
  month: string;
  name?: string;
  income: number;
  expense: number;
  balance: number;
  '支出'?: number;
  '収入'?: number;
}

export interface AppData {
  summary: { 
    currentBalance: number; 
    totalIncome: number; 
    totalExpense: number;
    unrecoveredAdvance: number;
    unsettledTripSandbox: number;
  };
  records: Transaction[];
  expenseData: ExpenseData[];
  monthlyData: MonthlyData[];
  accountBalances: AccountBalance[];
  monthlySettings: Record<string, MonthlySettings>;
  wishlist: WishlistItem[];
  ignoredBudgetCategories: string[];
  categoryBudgets: CategoryBudget[];
  error?: string;
}

// Represent the structure of the JSON database
export interface Database {
  records: Transaction[];
  monthlySettings: Record<string, MonthlySettings>;
  accounts: AccountBalance[];
  wishlist: WishlistItem[];
  ignoredBudgetCategories: string[];
  categoryBudgets?: CategoryBudget[];
}
