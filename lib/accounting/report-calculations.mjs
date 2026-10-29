const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

export function calculateTrialBalance(rows) {
  const accounts = rows.map((row) => {
    const debit = roundMoney(row.debit);
    const credit = roundMoney(row.credit);
    return {
      ...row,
      debit,
      credit,
      debitBalance: roundMoney(Math.max(debit - credit, 0)),
      creditBalance: roundMoney(Math.max(credit - debit, 0)),
    };
  }).filter((row) => row.debit !== 0 || row.credit !== 0);

  return {
    accounts,
    totals: {
      debit: roundMoney(accounts.reduce((sum, row) => sum + row.debit, 0)),
      credit: roundMoney(accounts.reduce((sum, row) => sum + row.credit, 0)),
      debitBalance: roundMoney(accounts.reduce((sum, row) => sum + row.debitBalance, 0)),
      creditBalance: roundMoney(accounts.reduce((sum, row) => sum + row.creditBalance, 0)),
    },
  };
}

export function calculateIncomeStatement(rows) {
  const accounts = rows.map((row) => {
    const debit = roundMoney(row.debit);
    const credit = roundMoney(row.credit);
    const amount = row.accountType === "income" ? credit - debit : debit - credit;
    return { ...row, debit, credit, amount: roundMoney(amount) };
  }).filter((row) => Math.abs(row.amount) > 0.005);

  const income = roundMoney(accounts.filter((row) => row.accountType === "income").reduce((sum, row) => sum + row.amount, 0));
  const expenses = roundMoney(accounts.filter((row) => row.accountType === "expense").reduce((sum, row) => sum + row.amount, 0));
  return { accounts, totals: { income, expenses, netResult: roundMoney(income - expenses) } };
}

export function calculateBalanceSheet(rows, accumulatedResult) {
  const accounts = rows.map((row) => {
    const debit = roundMoney(row.debit);
    const credit = roundMoney(row.credit);
    const balance = row.accountType === "asset" ? debit - credit : credit - debit;
    return { ...row, debit, credit, balance: roundMoney(balance) };
  }).filter((row) => Math.abs(row.balance) > 0.005);

  const assets = roundMoney(accounts.filter((row) => row.accountType === "asset").reduce((sum, row) => sum + row.balance, 0));
  const liabilities = roundMoney(accounts.filter((row) => row.accountType === "liability").reduce((sum, row) => sum + row.balance, 0));
  const equity = roundMoney(accounts.filter((row) => row.accountType === "equity").reduce((sum, row) => sum + row.balance, 0));
  const result = roundMoney(accumulatedResult);
  return {
    accounts,
    accumulatedResult: result,
    totals: {
      assets,
      liabilities,
      equity,
      accumulatedResult: result,
      liabilitiesAndEquity: roundMoney(liabilities + equity + result),
      difference: roundMoney(assets - liabilities - equity - result),
    },
  };
}
