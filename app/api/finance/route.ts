import { NextResponse } from 'next/server';

import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { Database, Transaction, MonthlySettings, FixedExpense, WishlistItem, AccountBalance } from '../../types';

export const dynamic = 'force-dynamic';

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

const DEFAULT_FIXED_EXPENSES = [
  { id: "1", name: "ホームステイ等、必要経費", amount: 0 },
  { id: "2", name: "食費", amount: 0 },
  { id: "3", name: "衣服代", amount: 0 },
  { id: "4", name: "ガソリン交通費", amount: 0 },
  { id: "5", name: "環境・自己投資", amount: 0 },
  { id: "6", name: "娯楽・リフレッシュ費", amount: 0 },
  { id: "7", name: "特別体験・イベント費", amount: 0 }
];

async function readDB() {
  let parsed: any = { 
    records: [], 
    monthlySettings: {},
    accounts: [
      { id: 'main', name: 'メイン口座' },
      { id: 'savings', name: '貯金口座' }
    ]
  };

  try {
    const supabase = getSupabase();
    
    // Read Settings from Supabase
    const { data: settingsData, error: settingsError } = await supabase.from('transactions').select('*').eq('record_type', 'app_settings').eq('category', 'global_settings');
    if (settingsError) {
      console.error('Supabase settings fetch error:', settingsError);
    }
    
    if (settingsData && settingsData.length > 0) {
      try {
        const p = JSON.parse(settingsData[0].description);
        if (p.monthlySettings) parsed.monthlySettings = p.monthlySettings;
        if (p.accounts) parsed.accounts = p.accounts;
        if (p.categoryBudgets) parsed.categoryBudgets = p.categoryBudgets;
        if (p.wishlist) parsed.wishlist = p.wishlist;
        if (p.ignoredBudgetCategories) parsed.ignoredBudgetCategories = p.ignoredBudgetCategories;
      } catch (e) {
        console.error('Failed to parse settings from Supabase', e);
      }
    }

    const { data: txs, error } = await supabase.from('transactions').select('*').neq('record_type', 'app_settings').order('created_at', { ascending: true });
    if (error) {
      console.error('Supabase fetch error:', error);
    }
    if (txs) {
      parsed.records = txs.map(t => ({
        ...t,
        recordType: t.record_type,
        expense: Number(t.expense),
        income: Number(t.income)
      }));
    }
  } catch (error) {
    console.error('Supabase connection error in readDB:', error);
  }

  return parsed;
}

async function writeDB(data: Database) {
  try {
    const supabase = getSupabase();
    const settingsData = {
      monthlySettings: data.monthlySettings,
      accounts: data.accounts,
      categoryBudgets: data.categoryBudgets,
      wishlist: data.wishlist,
      ignoredBudgetCategories: data.ignoredBudgetCategories
    };

    const { data: existing, error: selectError } = await supabase.from('transactions').select('id').eq('record_type', 'app_settings').eq('category', 'global_settings');
    
    if (selectError) {
      throw new Error(`Select error: ${selectError.message}`);
    }

    if (existing && existing.length > 0) {
      const { error: updateError } = await supabase.from('transactions').update({ description: JSON.stringify(settingsData) }).eq('id', existing[0].id);
      if (updateError) throw new Error(`Update error: ${updateError.message}`);
    } else {
      const { error: insertError } = await supabase.from('transactions').insert({
        record_type: 'app_settings',
        category: 'global_settings',
        description: JSON.stringify(settingsData),
        date: new Date().toISOString(),
        month: 'settings',
        expense: 0,
        income: 0,
        reconciled: false
      });
      if (insertError) throw new Error(`Insert error: ${insertError.message}`);
    }
  } catch (e) {
    console.error('Failed to write settings to Supabase', e);
    throw e;
  }
}


export async function GET(req: Request) {
  try {
    const db = await readDB();
    const rows = db.records || [];
    const wishlist = db.wishlist || [];
    const ignoredBudgetCategories = db.ignoredBudgetCategories || [];

    let totalIncome = 0;
    let totalExpense = 0;
    let currentBalance = 0;
    
    const expensesByCategory: Record<string, number> = {};
    const monthlyDataMap: Record<string, { income: number, expense: number, categories: Record<string, number> }> = {};
    let unrecoveredAdvance = 0;
    let unsettledSandbox = 0;

    if (rows && rows.length > 0) {
      rows.forEach((row: any) => {
        const category = row.category || 'その他';
        const expense = parseFloat(row.expense) || 0;
        const income = parseFloat(row.income) || 0;
        const month = row.month || '不明';
        const recordType = row.recordType || 'expense_normal';

        totalIncome += income;
        totalExpense += expense;
        
        if (recordType === 'advance_payment') unrecoveredAdvance += expense;
        if (recordType === 'advance_recovery') unrecoveredAdvance -= income;

        if (recordType === 'trip_sandbox') unsettledSandbox += expense;

        const isExcludedExpense = recordType === 'advance_payment' || recordType === 'trip_sandbox' || recordType === 'trip_sandbox_settled' || ignoredBudgetCategories.includes(category);
        const isExcludedIncome = recordType === 'advance_recovery' || recordType === 'income_special' || recordType === 'trip_reconcile';

        if (expense !== 0 && category !== '入金' && !isExcludedExpense) {
          expensesByCategory[category] = (expensesByCategory[category] || 0) + expense;
        }

        if (!monthlyDataMap[month]) {
          monthlyDataMap[month] = { income: 0, expense: 0, categories: {} };
        }
        
        if (!isExcludedIncome) {
          monthlyDataMap[month].income += income;
        }
        if (!isExcludedExpense) {
          monthlyDataMap[month].expense += expense;
        }
        
        if (expense !== 0 && category !== '入金' && !isExcludedExpense) {
          monthlyDataMap[month].categories[category] = (monthlyDataMap[month].categories[category] || 0) + expense;
        }
      });
    }

    currentBalance = totalIncome - totalExpense;

    const expenseData = Object.keys(expensesByCategory).map(key => ({
      name: key,
      value: expensesByCategory[key]
    })).sort((a, b) => b.value - a.value);

    const monthlyData = Object.keys(monthlyDataMap)
      .filter(key => key !== '不明')
      .map(key => ({
        name: key,
        収入: monthlyDataMap[key].income,
        支出: monthlyDataMap[key].expense,
        ...monthlyDataMap[key].categories
      })).sort((a, b) => a.name.localeCompare(b.name));

    // Group actual payments per month per category
    const actualPaymentsByMonthCategory: Record<string, Record<string, number>> = {};
    if (rows && rows.length > 0) {
      rows.forEach((row: any) => {
        const expense = parseFloat(row.expense) || 0;
        const month = row.month;
        const category = row.category;
        const recordType = row.recordType || 'expense_normal';
        const isExcludedExpense = recordType === 'advance_payment' || recordType === 'trip_sandbox' || recordType === 'trip_sandbox_settled';
        
        if (expense !== 0 && month && category && !isExcludedExpense) {
          if (!actualPaymentsByMonthCategory[month]) actualPaymentsByMonthCategory[month] = {};
          actualPaymentsByMonthCategory[month][category] = (actualPaymentsByMonthCategory[month][category] || 0) + expense;
        }
      });
    }

    // Calculate Savings and Future Fixed Expenses
    const { searchParams } = new URL(req.url);
    const clientMonthParam = searchParams.get('clientMonth');
    const today = new Date();
    const currentMonthStr = clientMonthParam || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    let pastSavings = 0;
    let plannedSavings = 0;
    
    Object.keys(db.monthlySettings).forEach(month => {
      const savingsGoal = parseFloat(db.monthlySettings[month].savingsGoal) || 0;
      if (month < currentMonthStr) {
        pastSavings += savingsGoal;
      } else {
        plannedSavings += savingsGoal;
      }
    });

    const currentMonthSettings = db.monthlySettings[currentMonthStr] || { fixedExpenses: DEFAULT_FIXED_EXPENSES, savingsGoal: 0 };
    
    const activeCategories = currentMonthSettings.fixedExpenses.filter((item: any) => !ignoredBudgetCategories.includes(item.name));
    
    let totalReservedForCategories = 0;

    // Define Category Rules
    const CATEGORY_RULES: Record<string, { isRolloverEnabled: boolean, maxPoolCap?: number, overflowAction?: 'DISCARD' | 'TRANSFER_TO_EVENT_FUND' }> = {
      '環境・自己投資': { isRolloverEnabled: true, maxPoolCap: 350, overflowAction: 'DISCARD' },
      '衣服代': { isRolloverEnabled: true, maxPoolCap: 250, overflowAction: 'DISCARD' },
      '娯楽・リフレッシュ費': { isRolloverEnabled: true, maxPoolCap: 150, overflowAction: 'TRANSFER_TO_EVENT_FUND' },
      '食費': { isRolloverEnabled: false, overflowAction: 'TRANSFER_TO_EVENT_FUND' }
    };

    let totalTransferredToEventFund = 0;
    const pastAndCurrentMonths = Object.keys(db.monthlySettings).filter(m => m <= currentMonthStr).sort();

    // Category Budgets Breakdown (with Rollover and Capping)
    const categoryBudgets = activeCategories.map((item: any) => {
      const catName = item.name;
      const rule = CATEGORY_RULES[catName] || { isRolloverEnabled: false };
      let currentRollover = 0;
      
      let currentData = { budgetAmount: 0, carriedOver: 0, pool: 0, spent: 0, remaining: 0, isCapped: false, overflowAmount: 0 };
      
      pastAndCurrentMonths.forEach(month => {
        const isCurrentMonth = month === currentMonthStr;
        const pastBudgetItem = db.monthlySettings[month]?.fixedExpenses?.find((f: any) => f.name === catName);
        const budgetAmount = pastBudgetItem ? parseFloat(pastBudgetItem.amount) || 0 : 0;
        const spentAmount = (actualPaymentsByMonthCategory[month] && actualPaymentsByMonthCategory[month][catName]) ? actualPaymentsByMonthCategory[month][catName] : 0;
        
        let pool = budgetAmount;
        if (rule.isRolloverEnabled && currentRollover > 0) {
           pool += currentRollover;
        } else if (rule.isRolloverEnabled && currentRollover < 0) {
           // Subtract negative rollover (overspending) from new budget
           pool += currentRollover;
        }

        let overflow = 0;
        let isCapped = false;
        if (rule.maxPoolCap !== undefined && pool > rule.maxPoolCap) {
           overflow = pool - rule.maxPoolCap;
           pool = rule.maxPoolCap;
           isCapped = true;
        }
        
        if (overflow > 0 && rule.overflowAction === 'TRANSFER_TO_EVENT_FUND') {
           totalTransferredToEventFund += overflow;
        }
        
        if (isCurrentMonth) {
           currentData = {
              budgetAmount,
              carriedOver: rule.isRolloverEnabled ? currentRollover : 0,
              pool,
              spent: spentAmount,
              remaining: pool - spentAmount,
              isCapped,
              overflowAmount: overflow
           };
        } else {
           let remaining = pool - spentAmount;
           if (remaining > 0) {
              if (month <= '2026-06') {
                 currentRollover = 0;
              } else if (!rule.isRolloverEnabled) {
                 if (rule.overflowAction === 'TRANSFER_TO_EVENT_FUND') {
                    totalTransferredToEventFund += remaining;
                 }
                 currentRollover = 0;
              } else {
                 currentRollover = remaining;
              }
           } else {
              if (month <= '2026-06') {
                 currentRollover = 0; // Ignore deficits for June and earlier
              } else {
                 currentRollover = rule.isRolloverEnabled ? remaining : 0;
              }
           }
        }
      });
      
      const remaining = currentData.remaining;

      // Calculate future reserved (months after current)
      let futureReserved = 0;
      Object.keys(db.monthlySettings).forEach(month => {
        if (month > currentMonthStr) {
           const fItem = db.monthlySettings[month].fixedExpenses.find((f: any) => f.name === item.name);
           if (fItem) {
             const fBudget = parseFloat(fItem.amount) || 0;
             const fSpent = (actualPaymentsByMonthCategory[month] && actualPaymentsByMonthCategory[month][item.name]) ? actualPaymentsByMonthCategory[month][item.name] : 0;
             futureReserved += Math.max(0, fBudget - fSpent);
           }
        }
      });
      
      // Total reserved for this category across all time
      const bucketBalance = remaining + futureReserved;
      if (bucketBalance > 0) {
        totalReservedForCategories += bucketBalance;
      }

      return {
        name: catName,
        budget: currentData.pool, // effectively the pool
        spent: currentData.spent,
        remaining: currentData.remaining,
        futureReserved,
        originalBudget: currentData.budgetAmount,
        carriedOver: currentData.carriedOver,
        isCapped: currentData.isCapped,
        overflowAmount: currentData.overflowAmount,
        rule
      };
    });
    
    let currentMonthVariableExpenses = 0;
    const fixedCategoryNames = currentMonthSettings.fixedExpenses
      .filter((f: any) => !ignoredBudgetCategories.includes(f.name))
      .map((f: any) => f.name);
    if (rows && rows.length > 0) {
      rows.forEach((row: any) => {
        const recordType = row.recordType || 'expense_normal';
        const isExcludedExpense = recordType === 'advance_payment' || recordType === 'trip_sandbox' || recordType === 'trip_sandbox_settled';
        if (row.month === currentMonthStr) {
          const expense = parseFloat(row.expense) || 0;
          const category = row.category || 'その他';
          if (expense !== 0 && category !== '入金' && !fixedCategoryNames.includes(category) && !isExcludedExpense) {
            currentMonthVariableExpenses += expense;
          }
        }
      });
    }

    // Add transferred funds to 特別体験・イベント費 (Event Fund)
    const eventFundCategory = categoryBudgets.find((c: any) => c.name === '特別体験・イベント費');
    if (eventFundCategory) {
      eventFundCategory.budget += totalTransferredToEventFund;
      eventFundCategory.remaining += totalTransferredToEventFund;
      eventFundCategory.transferredIn = totalTransferredToEventFund;
    }

    const realBalance = currentBalance - pastSavings - plannedSavings - totalReservedForCategories - totalTransferredToEventFund;

    const accountBalances = [
      { id: 'main', name: 'メイン口座 (実質)', balance: realBalance },
      { id: 'savings', name: '貯金口座', past: pastSavings, planned: plannedSavings, total: pastSavings + plannedSavings },
      { id: 'current_variable', name: '今月の変動費', balance: currentMonthVariableExpenses }
    ];

    let advice = '「✨ AIにアドバイスをもらう」ボタンを押すと、今月の状況をAIが分析します！';

    return NextResponse.json({
      success: true,
      data: {
        records: rows,
        summary: { currentBalance, unrecoveredAdvance, unsettledSandbox },
        expenseData,
        monthlyData,
        accountBalances,
        monthlySettings: db.monthlySettings,
        categoryBudgets,
        wishlist,
        ignoredBudgetCategories,
        advice
      }
    });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const db = await readDB();

    if (body.action === 'import_csv') {
      const csvData = body.csv;
      const parsed = parse(csvData, {
        skip_empty_lines: true,
        trim: true,
        from_line: 2
      });

      const newRecords = parsed.map((row: string[]) => {
  if (row[0] && row[0].match(/^\d{2}\/\d{2}\/\d{4}$/)) {
    const parts = row[0].split('/');
    const formattedDate = `${parts[2]}/${parts[0]}/${parts[1]}`;
    
    const cleanAmountStr = (row[2] || '').replace(/[$,\s]/g, '');
    const amount = parseFloat(cleanAmountStr) || 0;
    const isExpense = amount < 0;
    
    let parsedBalance = 0;
    // Scan remaining columns backwards to find a valid running balance
    for (let i = row.length - 1; i >= 3; i--) {
      if (row[i]) {
        const cleanBalStr = row[i].replace(/[$,\s]/g, '');
        const val = parseFloat(cleanBalStr);
        if (!isNaN(val) && val !== amount) {
          parsedBalance = val;
          break;
        }
      }
    }

    return {
      date: formattedDate,
      description: row[1] || '',
      category: '',
      expense: isExpense ? Math.abs(amount) : 0,
      income: !isExpense ? amount : 0,
      balance: parsedBalance,
      month: `${parts[2]}-${parts[0]}`
    };
  } else {
    return {
      description: row[0] || '',
      date: row[1] || '',
      category: row[2] || '',
      expense: parseFloat(row[3]) || 0,
      income: parseFloat(row[4]) || 0,
      balance: parseFloat(row[5]) || 0,
      month: row[6] || ''
    };
  }
});

      return NextResponse.json({ success: true, records: newRecords });

    } else if (body.action === 'batch_reconcile' || body.action === 'batch_update') {
      const supabase = getSupabase();

      if (body.action === 'batch_update') {
        const { records } = body;
        if (records && Array.isArray(records)) {
          for (const updatedRecord of records) {
            if (updatedRecord.id) {
              const { error } = await supabase.from('transactions').update({
                category: updatedRecord.category,
                description: updatedRecord.description,
                reconciled: true
              }).eq('id', updatedRecord.id);
              if (error) throw new Error(`Batch update error (id: ${updatedRecord.id}): ${error.message}`);
            } else {
              const { error } = await supabase.from('transactions').insert({
                description: updatedRecord.description || '',
                date: updatedRecord.date || '',
                category: updatedRecord.category || '',
                expense: updatedRecord.expense || 0,
                income: updatedRecord.income || 0,
                balance: 0,
                month: updatedRecord.month || (updatedRecord.date ? updatedRecord.date.substring(0, 7).replace('/', '-') : ''),
                record_type: updatedRecord.recordType || 'expense_normal',
                reconciled: true
              });
              if (error) throw new Error(`Batch insert error: ${error.message}`);
            }
          }
        }
      } else {
        const { reconciledIds, newRecords } = body.payload;
        if (reconciledIds && Array.isArray(reconciledIds)) {
          const idsToUpdate = reconciledIds.filter(id => typeof id === 'string');
          
          if (idsToUpdate.length > 0) {
            // Batch update all matched records to reconciled: true
            const { error } = await supabase.from('transactions').update({ reconciled: true }).in('id', idsToUpdate);
            if (error) throw new Error(`Batch reconcile update error: ${error.message}`);
          }
        }

        if (newRecords && Array.isArray(newRecords) && newRecords.length > 0) {
          const inserts = newRecords.map((r: any) => ({
            description: r.description || '',
            date: r.date || '',
            category: r.category || '',
            expense: r.expense || 0,
            income: r.income || 0,
            balance: 0,
            month: r.month || (r.date ? r.date.substring(0, 7).replace('/', '-') : ''),
            record_type: r.recordType || 'expense_normal',
            reconciled: true
          }));
          const { error } = await supabase.from('transactions').insert(inserts);
          if (error) throw new Error(`Batch reconcile insert error: ${error.message}`);
        }
      }

      return NextResponse.json({ success: true, message: '照合が完了しました。' });
    } else if (body.action === 'export_db') {
      return NextResponse.json({ success: true, db });

    } else if (body.action === 'import_db') {
      const importedDb = body.payload;
      if (!importedDb || !importedDb.records) {
        return NextResponse.json({ error: '無効なバックアップデータです' }, { status: 400 });
      }
      await writeDB(importedDb);
      return NextResponse.json({ success: true, message: 'データを復元しました。' });

    } else if (body.action === 'add_expense') {
      const { date, category, description, amount, recordType } = body.payload;
      
      let expenseAmount = parseFloat(amount) || 0;
      let incomeAmount = 0;

      if (recordType === 'income_allowance' || recordType === 'income_special' || recordType === 'advance_recovery') {
        incomeAmount = Math.abs(expenseAmount);
        expenseAmount = 0;
      } else if (recordType === 'refund') {
        expenseAmount = -Math.abs(expenseAmount);
      } else {
        expenseAmount = Math.abs(expenseAmount);
      }
      
      let month = '不明';
      if (date) {
        const parts = date.split('/');
        if (parts.length >= 2) {
          month = `${parts[0]}-${parts[1].padStart(2, '0')}`;
        } else if (date.includes('-')) {
           const p = date.split('-');
           month = `${p[0]}-${p[1]}`;
        }
      }

      const supabase = getSupabase();
      const { error } = await supabase.from('transactions').insert({
        description: description || '',
        date: date || '',
        category: category || '',
        expense: expenseAmount,
        income: incomeAmount,
        month: month,
        record_type: recordType || 'expense_normal',
        reconciled: false
      });

      if (error) {
        console.error('Supabase Insert Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: '記録を追加しました。' });

    } else if (body.action === 'trip_reconcile') {
      const { date, myShare, recovered } = body.payload;
      
      const share = parseFloat(myShare) || 0;
      const recov = parseFloat(recovered) || 0;
      const totalSandbox = share + recov;

      let month = '不明';
      if (date) {
        const parts = date.split('/');
        if (parts.length >= 2) {
          month = `${parts[0]}-${parts[1].padStart(2, '0')}`;
        }
      }

      const newTripRecord = {
        description: `旅行一括精算 (総額$${totalSandbox.toFixed(2)} / 回収$${recov.toFixed(2)})`,
        date: date || '',
        category: '特別体験・イベント費',
        expense: share,
        income: recov,
        month: month,
        record_type: 'trip_reconcile',
        reconciled: true
      };

      const supabase = getSupabase();
      await supabase.from('transactions').insert(newTripRecord);
      await supabase.from('transactions').update({ record_type: 'trip_sandbox_settled' }).eq('record_type', 'trip_sandbox');

      return NextResponse.json({ success: true, message: '旅行の精算が完了しました。' });

    } else if (body.action === 'update_monthly_settings') {
      const { month, fixedExpenses, savingsGoal } = body.payload;
      db.monthlySettings[month] = {
        fixedExpenses,
        savingsGoal: parseFloat(savingsGoal) || 0
      };
      await writeDB(db);
      return NextResponse.json({ success: true, message: '月間設定を更新しました。' });

    } else if (body.action === 'delete_monthly_settings') {
      const { month } = body.payload;
      if (db.monthlySettings && db.monthlySettings[month]) {
        delete db.monthlySettings[month];
        await writeDB(db);
      }
      return NextResponse.json({ success: true, message: '月間設定を削除しました。' });
      
    } else if (body.action === 'add_wishlist') {
      const { id, name, amount, category } = body.payload;
      if (!db.wishlist) db.wishlist = [];
      db.wishlist.push({ id, name, amount: parseFloat(amount) || 0, category, isApplied: true });
      await writeDB(db);
      return NextResponse.json({ success: true, message: '欲しいものを追加しました。' });
      
    } else if (body.action === 'toggle_wishlist') {
      const { id, isApplied } = body.payload;
      if (db.wishlist) {
        const item = db.wishlist.find((w: WishlistItem) => w.id === id);
        if (item) item.isApplied = isApplied;
        await writeDB(db);
      }
      return NextResponse.json({ success: true, message: '状態を更新しました。' });
      
    } else if (body.action === 'delete_wishlist') {
      const { id } = body.payload;
      if (db.wishlist) {
        db.wishlist = db.wishlist.filter((w: WishlistItem) => w.id !== id);
        await writeDB(db);
      }
      return NextResponse.json({ success: true, message: '削除しました。' });
      
    } else if (body.action === 'update_wishlist') {
      const { id, name, amount, category } = body.payload;
      if (db.wishlist) {
        const item = db.wishlist.find((w: WishlistItem) => w.id === id);
        if (item) {
          item.name = name;
          item.amount = parseFloat(amount) || 0;
          item.category = category;
        }
        await writeDB(db);
      }
      return NextResponse.json({ success: true, message: '更新しました。' });
      
    } else if (body.action === 'toggle_ignored_budget_category') {
      const { category, isIgnored } = body.payload;
      if (!db.ignoredBudgetCategories) db.ignoredBudgetCategories = [];
      if (isIgnored && !db.ignoredBudgetCategories.includes(category)) {
        db.ignoredBudgetCategories.push(category);
      } else if (!isIgnored) {
        db.ignoredBudgetCategories = db.ignoredBudgetCategories.filter((c: string) => c !== category);
      }
      await writeDB(db);
      return NextResponse.json({ success: true, message: '設定を更新しました。' });
    } else if (body.action === 'transfer_budget') {
      const { month, fromCategory, toCategory, amount } = body.payload;
      const transferAmount = parseFloat(amount);
      
      if (!db.monthlySettings[month]) {
        return NextResponse.json({ error: '対象月の予算設定が見つかりません' }, { status: 400 });
      }
      
      const fixed = db.monthlySettings[month].fixedExpenses;
      
      let fromItem = fixed.find((f: FixedExpense) => f.name === fromCategory);
      if (!fromItem) {
        fromItem = { id: `cat_${Date.now()}_1`, name: fromCategory, amount: 0 };
        fixed.push(fromItem);
      }
      
      let toItem = fixed.find((f: FixedExpense) => f.name === toCategory);
      if (!toItem) {
        toItem = { id: `cat_${Date.now()}_2`, name: toCategory, amount: 0 };
        fixed.push(toItem);
      }
      
      fromItem.amount = (parseFloat(fromItem.amount) - transferAmount).toString();
      toItem.amount = (parseFloat(toItem.amount) + transferAmount).toString();
      
      await writeDB(db);
      return NextResponse.json({ success: true, message: '予算を移動しました' });


    } else if (body.action === 'edit_record' || body.action === 'delete_record') {
      const { id, ...payload } = body.payload;
      const targetRecord = db.records.find((r: any) => r.id === id);
      if (targetRecord) {
        const supabase = getSupabase();
        
        if (body.action === 'delete_record') {
          await supabase.from('transactions').delete().eq('id', targetRecord.id);
        } else {
          let exp = parseFloat(payload.expense) || 0;
          let inc = parseFloat(payload.income) || 0;
          const recType = payload.recordType || targetRecord.recordType;
          
          if (recType === 'income_allowance' || recType === 'income_special' || recType === 'advance_recovery') {
            inc = Math.abs(exp || inc);
            exp = 0;
          } else if (recType === 'refund') {
            exp = -Math.abs(exp || inc);
            inc = 0;
          } else if (recType === 'advance_payment' || recType === 'expense_normal') {
            exp = Math.abs(exp || inc);
            inc = 0;
          }

          await supabase.from('transactions').update({
            description: payload.description || '',
            date: payload.date || '',
            category: payload.category || '',
            expense: exp,
            income: inc,
            month: payload.month || targetRecord.month,
            record_type: recType,
            reconciled: payload.reconciled !== undefined ? payload.reconciled : targetRecord.reconciled
          }).eq('id', targetRecord.id);
        }
        
        return NextResponse.json({ success: true, message: body.action === 'delete_record' ? '削除しました。' : '更新しました。' });
      } else {
        return NextResponse.json({ error: 'レコードが見つかりません。' }, { status: 404 });
      }
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error: unknown) {
    console.error(error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
