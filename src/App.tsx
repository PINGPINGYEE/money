import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import {
  createCustomer,
  createProduct,
  deleteCustomer,
  deleteProduct,
  fetchAppData,
  recordCreditPayment,
  recordReturn,
  recordSale,
  recordStockEntry,
  updateCustomer,
  updateProduct,
} from "./api";
import type {
  AppData,
  Customer,
  CustomerBalance,
  Product,
  SaleRecord,
  StockMovement,
} from "./types";

type TabKey =
  | "products"
  | "customers"
  | "sales"
  | "ledger"
  | "credit"
  | "reports";

type ProductFormState = {
  mode: "create" | "edit";
  id?: number;
  name: string;
  unit_price: string;
  low_stock_threshold: string;
  initial_qty: string;
  qty: string;
  note: string;
};

type CustomerFormState = {
  mode: "create" | "edit";
  id?: number;
  name: string;
  phone: string;
  note: string;
};

type SaleFormState = {
  product_id: string;
  qty: string;
  amount: string;
  customer_id: string;
  is_credit: boolean;
  note: string;
};

type ReturnFormState = {
  customer_id: string;
  product_id: string;
  qty: string;
  note: string;
  amount: string;
};

type StockFormState = {
  product_id: string;
  kind: "IN" | "OUT";
  qty: string;
  unit_price: string;
  counterparty: string;
  customer_id: string;
  note: string;
};

type PaymentFormState = {
  customer_id: string;
  amount: string;
  note: string;
};

type LedgerFilterState = {
  customer: string;
  product: string;
  startDate: string;
  endDate: string;
  onlyCredit: boolean;
};

type LedgerSummaryRow = {
  key: string;
  customerId: number | null;
  name: string;
  phone: string | null;
  qty: number;
  total: number;
  credit: number;
};

type ReturnCombo = {
  customerId: number | null;
  customerName: string;
  customerPhone: string | null;
  productId: number;
  productName: string;
  outstanding: number;
  saleEntries: Array<{ sale: SaleRecord; remaining: number }>;
};

const RETURN_WALKIN_CUSTOMER_KEY = "__walkin__";

function customerSelectionValue(customerId: number | null): string {
  return customerId == null ? RETURN_WALKIN_CUSTOMER_KEY : customerId.toString();
}

function isReturnCustomerSelected(value: string): boolean {
  return value !== "";
}

function parseReturnCustomerId(value: string): number | null {
  if (!isReturnCustomerSelected(value) || value === RETURN_WALKIN_CUSTOMER_KEY) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesReturnCustomer(
  comboCustomerId: number | null,
  selection: string,
): boolean {
  if (!isReturnCustomerSelected(selection)) {
    return false;
  }
  const selectedId = parseReturnCustomerId(selection);
  if (selectedId === null) {
    return comboCustomerId === null;
  }
  return comboCustomerId === selectedId;
}

function createEmptyProductForm(): ProductFormState {
  return {
    mode: "create",
    name: "",
    unit_price: "",
    low_stock_threshold: "5",
    initial_qty: "",
    qty: "",
    note: "",
  };
}

function createEmptyCustomerForm(): CustomerFormState {
  return {
    mode: "create",
    name: "",
    phone: "",
    note: "",
  };
}

function createEmptySaleForm(): SaleFormState {
  return {
    product_id: "",
    qty: "1",
    amount: "",
    customer_id: "",
    is_credit: false,
    note: "",
  };
}

function createEmptyReturnForm(): ReturnFormState {
  return {
    customer_id: "",
    product_id: "",
    qty: "",
    note: "",
    amount: "",
  };
}

function createEmptyStockForm(): StockFormState {
  return {
    product_id: "",
    kind: "IN",
    qty: "1",
    unit_price: "",
    counterparty: "",
    customer_id: "",
    note: "",
  };
}

function createEmptyPaymentForm(): PaymentFormState {
  return {
    customer_id: "",
    amount: "",
    note: "",
  };
}

function createEmptyLedgerFilter(): LedgerFilterState {
  return {
    customer: "",
    product: "",
    startDate: "",
    endDate: "",
    onlyCredit: false,
  };
}

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("products");

  const [productForm, setProductForm] = useState<ProductFormState>(
    createEmptyProductForm,
  );
  const [customerForm, setCustomerForm] = useState<CustomerFormState>(
    createEmptyCustomerForm,
  );
  const [saleForm, setSaleForm] = useState<SaleFormState>(createEmptySaleForm);
  const [saleProductQuery, setSaleProductQuery] = useState("");
  const [saleCustomerQuery, setSaleCustomerQuery] = useState("");
  const [returnForm, setReturnForm] =
    useState<ReturnFormState>(createEmptyReturnForm);
  const [stockForm, setStockForm] =
    useState<StockFormState>(createEmptyStockForm);
  const [stockProductQuery, setStockProductQuery] = useState("");
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(
    createEmptyPaymentForm,
  );
  const [creditCustomerQuery, setCreditCustomerQuery] = useState("");
  const [productStockPage, setProductStockPage] = useState(1);
  const [productListPage, setProductListPage] = useState(1);
  const [productListQuery, setProductListQuery] = useState("");
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null);
  const [ledgerFilter, setLedgerFilter] =
    useState<LedgerFilterState>(createEmptyLedgerFilter);

  const runAction = async (
    action: () => Promise<AppData>,
  ): Promise<AppData | null> => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await action();
      setData(snapshot);
      return snapshot;
    } catch (err) {
      setError(getErrorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runAction(fetchAppData);
  }, []);

  const lowStockProducts = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.products.filter(
      (product) => product.qty <= product.low_stock_threshold,
    );
  }, [data]);

  const outstandingByCustomer = useMemo(() => {
    const map = new Map<number, CustomerBalance>();
    data?.customer_balances.forEach((balance) => {
      map.set(balance.customer_id, balance);
    });
    return map;
  }, [data]);

  const outstandingCustomers = useMemo(() => {
    if (!data) {
      return [];
    }
    return data.customer_balances
      .filter((balance) => balance.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [data]);

  const productListForSale = useMemo(() => {
    if (!data) {
      return [] as Product[];
    }
    const q = saleProductQuery.trim().toLowerCase();
    if (!q) return data.products;
    return data.products.filter((p) => p.name.toLowerCase().includes(q));
  }, [data, saleProductQuery]);

  const customerListForSale = useMemo(() => {
    if (!data) {
      return [] as Customer[];
    }
    const q = saleCustomerQuery.trim().toLowerCase();
    if (!q) return data.customers;
    return data.customers.filter((c) => {
      const nameHit = c.name.toLowerCase().includes(q);
      const phoneHit = (c.phone ?? "").toLowerCase().includes(q);
      return nameHit || phoneHit;
    });
  }, [data, saleCustomerQuery]);

  const filteredSales = useMemo(() => {
    if (!data) {
      return [];
    }
    const startTime = ledgerFilter.startDate
      ? new Date(`${ledgerFilter.startDate}T00:00:00`).getTime()
      : null;
    const endTime = ledgerFilter.endDate
      ? new Date(`${ledgerFilter.endDate}T23:59:59`).getTime()
      : null;
    const customerTerm = ledgerFilter.customer.trim().toLowerCase();
    const productTerm = ledgerFilter.product.trim().toLowerCase();

    return data.sales.filter((sale) => {
      const saleTime = new Date(sale.ts).getTime();
      if (!Number.isFinite(saleTime)) {
        return false;
      }
      if (startTime && saleTime < startTime) {
        return false;
      }
      if (endTime && saleTime > endTime) {
        return false;
      }
      if (customerTerm) {
        const name = (sale.customer_name ?? "일반 손님").toLowerCase();
        const phoneDigits = (sale.customer_phone ?? "").replace(/\D/g, "");
        const term = customerTerm;
        const termDigits = term.replace(/\D/g, "");
        const termName = term.replace(/\(.+?\)/g, "").trim();
        const nameMatches = termName ? name.includes(termName) : false;
        const phoneMatches = termDigits.length >= 2 ? phoneDigits.includes(termDigits) : false;
        const hasParenDigits = /\(\s*\d{2,}\s*\)/.test(term);
        const matches = hasParenDigits ? (nameMatches && phoneMatches) : (nameMatches || phoneMatches);
        if (!matches) {
          return false;
        }
      }
      if (
        productTerm &&
        !sale.product_name.toLowerCase().includes(productTerm)
      ) {
        return false;
      }
      if (ledgerFilter.onlyCredit && !sale.is_credit) {
        return false;
      }
      return true;
    });
  }, [data, ledgerFilter]);

  const returnsBySale = useMemo(() => {
    const map = new Map<number, number>();
    data?.sales.forEach((sale) => {
      if (sale.is_return && sale.origin_sale_id != null) {
        const current = map.get(sale.origin_sale_id) ?? 0;
        map.set(sale.origin_sale_id, current + sale.qty);
      }
    });
    return map;
  }, [data]);

  const outstandingSaleEntries = useMemo(() => {
    if (!data) {
      return [] as Array<{ sale: SaleRecord; returned: number; remaining: number }>;
    }
    return data.sales
      .filter((sale) => !sale.is_return)
      .map((sale) => {
        const returned = returnsBySale.get(sale.id) ?? 0;
        const remaining = Math.max(sale.qty - returned, 0);
        return { sale, returned, remaining };
      })
      .filter(({ remaining }) => remaining > 0)
      .sort((a, b) => (a.sale.ts > b.sale.ts ? 1 : -1));
  }, [data, returnsBySale]);

  const returnCombos = useMemo<ReturnCombo[]>(() => {
    const combos = new Map<string, ReturnCombo>();
    outstandingSaleEntries.forEach((entry) => {
      const customerId = entry.sale.customer_id ?? null;
      const key = `${customerId ?? "NONE"}|${entry.sale.product_id}`;
      const existing = combos.get(key);
      if (existing) {
        existing.outstanding += entry.remaining;
        existing.saleEntries.push(entry);
      } else {
        combos.set(key, {
          customerId,
          customerName: entry.sale.customer_name ?? "일반 손님",
          customerPhone: entry.sale.customer_phone ?? null,
          productId: entry.sale.product_id,
          productName: entry.sale.product_name,
          outstanding: entry.remaining,
          saleEntries: [entry],
        });
      }
    });
    return Array.from(combos.values()).map((combo) => ({
      ...combo,
      saleEntries: [...combo.saleEntries].sort((a, b) =>
        a.sale.ts > b.sale.ts ? 1 : -1,
      ),
    }));
  }, [outstandingSaleEntries]);

  const returnCustomerOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    returnCombos.forEach((combo) => {
      const key = customerSelectionValue(combo.customerId);
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          label: formatNameWithPhone(combo.customerName, combo.customerPhone),
        });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ko"),
    );
  }, [returnCombos]);

  const productOptions = useMemo(() => {
    if (!isReturnCustomerSelected(returnForm.customer_id)) {
      return [];
    }
    return returnCombos
      .filter((combo) =>
        matchesReturnCustomer(combo.customerId, returnForm.customer_id),
      )
      .map((combo) => ({
        productId: combo.productId,
        productName: combo.productName,
        outstanding: combo.outstanding,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName, "ko"));
  }, [returnCombos, returnForm.customer_id]);

  const selectedReturnCombo = useMemo(() => {
    if (!returnForm.product_id) {
      return null;
    }
    const productId = Number(returnForm.product_id);
    if (!Number.isFinite(productId)) {
      return null;
    }
    return (
      returnCombos.find(
        (combo) =>
          combo.productId === productId &&
          matchesReturnCustomer(combo.customerId, returnForm.customer_id),
      ) ?? null
    );
  }, [returnCombos, returnForm.customer_id, returnForm.product_id]);

  const previewReturnAmount = useMemo(() => {
    if (!selectedReturnCombo) {
      return 0;
    }
    const requested = Math.min(
      parseNumber(returnForm.qty),
      selectedReturnCombo.outstanding,
    );
    if (requested <= 0) {
      return 0;
    }
    let remaining = requested;
    let amount = 0;
    for (const entry of selectedReturnCombo.saleEntries) {
      if (remaining <= 0) {
        break;
      }
      const portion = Math.min(entry.remaining, remaining);
      amount += portion * entry.sale.unit_price;
      remaining -= portion;
    }
    return amount;
  }, [selectedReturnCombo, returnForm.qty]);

  useEffect(() => {
    if (!returnCombos.length) {
      if (
        returnForm.customer_id ||
        returnForm.product_id ||
        returnForm.qty ||
        returnForm.note ||
        returnForm.amount
      ) {
        setReturnForm(createEmptyReturnForm());
      }
      return;
    }

    if (
      isReturnCustomerSelected(returnForm.customer_id) &&
      !returnCombos.some((combo) =>
        matchesReturnCustomer(combo.customerId, returnForm.customer_id),
      )
    ) {
      setReturnForm((prev) => ({
        customer_id: "",
        product_id: "",
        qty: "",
        note: prev.note,
        amount: prev.amount,
      }));
      return;
    }

    if (!returnForm.product_id) {
      return;
    }

    if (!selectedReturnCombo) {
      if (returnForm.product_id || returnForm.qty) {
        setReturnForm((prev) => ({
          ...prev,
          product_id: "",
          qty: "",
          amount: "",
        }));
      }
      return;
    }

    const maxQty = selectedReturnCombo.outstanding;
    const nextQty = maxQty.toString();
    if (!returnForm.qty) {
      setReturnForm((prev) => ({
        ...prev,
        qty: nextQty,
        amount:
          selectedReturnCombo
            ? String(maxQty * selectedReturnCombo.saleEntries[0].sale.unit_price)
            : prev.amount,
      }));
      return;
    }

    // 더 이상 자동으로 수량을 강제로 조정하지 않는다. 제출 시에만 검증한다.
  }, [
    returnCombos,
    returnForm.customer_id,
    returnForm.product_id,
    returnForm.qty,
    returnForm.note,
    selectedReturnCombo,
  ]);

  const ledgerTotals = useMemo(() => {
    const totals = filteredSales.reduce(
      (acc, sale) => {
        const sign = sale.is_return ? -1 : 1;
        acc.total += sign * sale.total_amount;
        acc.qty += sign * sale.qty;
        if (sale.is_credit) {
          acc.credit += sign * sale.total_amount;
        }
        return acc;
      },
      { total: 0, credit: 0, qty: 0 },
    );
    return totals;
  }, [filteredSales]);

  const ledgerSummary = useMemo<LedgerSummaryRow[]>(() => {
    const summary = new Map<string, LedgerSummaryRow>();
    filteredSales.forEach((sale) => {
      const key = sale.customer_id != null ? String(sale.customer_id) : "NONE";
      const current = summary.get(key);
      const entry: LedgerSummaryRow =
        current ??
        {
          key,
          customerId: sale.customer_id,
          name: sale.customer_name ?? "일반 손님",
          phone: sale.customer_phone ?? null,
          qty: 0,
          total: 0,
          credit: 0,
        };
      const sign = sale.is_return ? -1 : 1;
      entry.qty += sign * sale.qty;
      entry.total += sign * sale.total_amount;
      if (sale.is_credit) {
        entry.credit += sign * sale.total_amount;
      }
      if (!entry.phone && sale.customer_phone) {
        entry.phone = sale.customer_phone;
      }
      if (entry.name === "일반 손님" && sale.customer_name) {
        entry.name = sale.customer_name;
      }
      summary.set(key, entry);
    });
    return Array.from(summary.values()).sort((a, b) => b.total - a.total);
  }, [filteredSales]);

  const monthlySales = useMemo(() => {
    if (!data) {
      return [] as Array<{
        month: string;
        paid: number;
        credit: number;
        outstanding: number;
        total: number;
      }>;
    }

    const map = new Map<
      string,
      {
        month: string;
        paid: number;
        credit: number;
        outstanding: number;
        total: number;
      }
    >();

    // 판매/반품 기준으로 완불과 외상 매출 집계
    data.sales.forEach((sale) => {
      const month = sale.ts.slice(0, 7);
      const entry =
        map.get(month) ?? { month, paid: 0, credit: 0, outstanding: 0, total: 0 };
      const sign = sale.is_return ? -1 : 1;
      if (sale.is_credit) {
        entry.credit += sign * sale.total_amount;
      } else {
        entry.paid += sign * sale.total_amount;
      }
      map.set(month, entry);
    });

    // 외상/결제 내역으로 해당 월의 미납 증감 집계
    data.credits.forEach((cr) => {
      const month = cr.ts.slice(0, 7);
      const entry =
        map.get(month) ?? { month, paid: 0, credit: 0, outstanding: 0, total: 0 };
      entry.outstanding += cr.is_payment ? -cr.amount : cr.amount;
      map.set(month, entry);
    });

    // 총 매출 계산 및 포맷
    const rows = Array.from(map.values()).map((row) => ({
      month: row.month,
      paid: row.paid,
      credit: row.credit,
      outstanding: Math.max(row.outstanding, 0),
      total: row.paid + row.credit,
    }));

    return rows.sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [data]);

  const topCustomers = useMemo(() => {
    if (!data) {
      return [];
    }
    const map = new Map<
      string,
      {
        id: number | null;
        name: string;
        phone: string | null;
        total: number;
        credit: number;
      }
    >();
    data.sales.forEach((sale) => {
      const key =
        sale.customer_id != null
          ? `id:${sale.customer_id}`
          : `walkin:${sale.customer_name ?? "일반 손님"}`;
      const entry =
        map.get(key) ??
        {
          id: sale.customer_id ?? null,
          name: sale.customer_name ?? "일반 손님",
          phone: sale.customer_phone ?? null,
          total: 0,
          credit: 0,
        };
      const sign = sale.is_return ? -1 : 1;
      entry.total += sign * sale.total_amount;
      if (sale.is_credit) {
        entry.credit += sign * sale.total_amount;
      }
      if (!entry.phone && sale.customer_phone) {
        entry.phone = sale.customer_phone;
      }
      if (entry.name === "일반 손님" && sale.customer_name) {
        entry.name = sale.customer_name;
      }
      map.set(key, entry);
    });
    const rows = Array.from(map.values()).filter((row) => row.id != null);
    return rows.sort((a, b) => b.total - a.total).slice(0, 5);
  }, [data]);

  const outstandingCustomersFiltered = useMemo(() => {
    const list = outstandingCustomers;
    const q = creditCustomerQuery.trim().toLowerCase();
    if (!q) return list;
    const hasParenDigits = /\(\s*\d{2,}\s*\)/.test(q);
    const termDigits = q.replace(/\D/g, "");
    const termName = q.replace(/\(.+?\)/g, "").trim();
    return list.filter((balance) => {
      const name = (balance.customer_name ?? "").toLowerCase();
      const phoneDigits = (balance.customer_phone ?? "").replace(/\D/g, "");
      const nameMatches = termName ? name.includes(termName) : false;
      const phoneMatches = termDigits.length >= 2 ? phoneDigits.includes(termDigits) : false;
      return hasParenDigits ? (nameMatches && phoneMatches) : (nameMatches || phoneMatches);
    });
  }, [outstandingCustomers, creditCustomerQuery]);

  const totalInventoryValue = useMemo(() => {
    if (!data) {
      return 0;
    }
    return data.products.reduce(
      (sum, product) => sum + product.qty * product.unit_price,
      0,
    );
  }, [data]);

  const productListForStock = useMemo(() => {
    if (!data) return [] as Product[];
    const q = stockProductQuery.trim().toLowerCase();
    if (!q) return data.products;
    return data.products.filter((p) => p.name.toLowerCase().includes(q));
  }, [data, stockProductQuery]);

  // (고객 기반 출고 입력은 제거됨)

  const handleProductSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!productForm.name.trim()) {
      setError("상품 이름을 입력해주세요.");
      return;
    }
    const unitPrice = parseNumber(productForm.unit_price);
    if (unitPrice < 0) {
      setError("단가는 0 이상이어야 합니다.");
      return;
    }

    if (productForm.mode === "create") {
      const payload = {
        name: productForm.name.trim(),
        unit_price: unitPrice,
        note: sanitizeNullable(productForm.note),
        low_stock_threshold: productForm.low_stock_threshold
          ? parseNumber(productForm.low_stock_threshold)
          : null,
        initial_qty: productForm.initial_qty
          ? parseNumber(productForm.initial_qty)
          : null,
      };
      const result = await runAction(() => createProduct(payload));
      if (result) {
        setProductForm(createEmptyProductForm());
      }
    } else if (productForm.mode === "edit" && productForm.id != null) {
      const payload = {
        id: productForm.id,
        name: productForm.name.trim(),
        unit_price: unitPrice,
        note: sanitizeNullable(productForm.note),
        low_stock_threshold: productForm.low_stock_threshold
          ? parseNumber(productForm.low_stock_threshold)
          : null,
      };

      const prevProduct = data?.products.find((p) => p.id === productForm.id) ?? null;
      const targetQty = productForm.qty ? parseNumber(productForm.qty) : null;

      const result = await runAction(() => updateProduct(payload));
      if (result && prevProduct != null && targetQty != null) {
        const diff = targetQty - prevProduct.qty;
        if (Math.abs(diff) > 1e-9) {
          const kind = diff > 0 ? ("IN" as const) : ("OUT" as const);
          const qtyAbs = Math.abs(diff);
          await runAction(() =>
            recordStockEntry({
              product_id: prevProduct.id,
              qty: qtyAbs,
              kind,
              unit_price: null,
              counterparty: "재고 조정",
              customer_id: null,
              note: "재고 직접 수정",
            }),
          );
        }
      }
      if (result) {
        setProductForm(createEmptyProductForm());
      }
    }
  };

  const handleProductEdit = (product: Product) => {
    setProductForm({
      mode: "edit",
      id: product.id,
      name: product.name,
      unit_price: product.unit_price.toString(),
      low_stock_threshold: product.low_stock_threshold.toString(),
      initial_qty: "",
      qty: product.qty.toString(),
      note: product.note ?? "",
    });
  };

  const handleProductDelete = async (product: Product) => {
    setPendingDeleteProduct(product);
  };

  const confirmProductDelete = async () => {
    if (!pendingDeleteProduct) return;
    const product = pendingDeleteProduct;
    const result = await runAction(() => deleteProduct(product.id));
    if (
      result &&
      productForm.mode === "edit" &&
      productForm.id === product.id
    ) {
      setProductForm(createEmptyProductForm());
    }
    setPendingDeleteProduct(null);
  };

const handleCustomerSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  if (!customerForm.name.trim()) {
    setError("고객 이름을 입력해주세요.");
    return;
  }
  const phone = customerForm.phone.trim();
  if (!phone) {
    setError("고객 연락처를 입력해주세요.");
    return;
  }

  if (customerForm.mode === "create") {
    const payload = {
      name: customerForm.name.trim(),
      phone,
      note: sanitizeNullable(customerForm.note),
    };
    const result = await runAction(() => createCustomer(payload));
    if (result) {
      setCustomerForm(createEmptyCustomerForm());
    }
  } else if (customerForm.mode === "edit" && customerForm.id != null) {
    const payload = {
      id: customerForm.id,
      name: customerForm.name.trim(),
      phone,
      note: sanitizeNullable(customerForm.note),
    };
    const result = await runAction(() => updateCustomer(payload));
    if (result) {
      setCustomerForm(createEmptyCustomerForm());
    }
  }
};

  const handleCustomerEdit = (customer: Customer) => {
    setCustomerForm({
      mode: "edit",
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? "",
      note: customer.note ?? "",
    });
  };

  const handleCustomerDelete = async (customer: Customer) => {
    const result = await runAction(() => deleteCustomer(customer.id));
    if (
      result &&
      customerForm.mode === "edit" &&
      customerForm.id === customer.id
    ) {
      setCustomerForm(createEmptyCustomerForm());
    }
  };

  const handleSaleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saleForm.product_id) {
      setError("판매할 상품을 선택해주세요.");
      return;
    }
    const productId = Number(saleForm.product_id);
    const qty = parseNumber(saleForm.qty);
    if (qty <= 0) {
      setError("미터은 0보다 커야 합니다.");
      return;
    }
    const amount = saleForm.amount ? parseNumber(saleForm.amount) : null;
    if (saleForm.is_credit && !saleForm.customer_id) {
      setError("외상 거래는 고객을 선택해야 합니다.");
      return;
    }
    const payload = {
      product_id: productId,
      qty,
      unit_price: amount != null ? amount / qty : null,
      customer_id: saleForm.customer_id ? Number(saleForm.customer_id) : null,
      note: sanitizeNullable(saleForm.note),
      is_credit: saleForm.is_credit,
    };
    const result = await runAction(() => recordSale(payload));
    if (result) {
      setSaleForm(createEmptySaleForm());
    }
  };

  const handleReturnSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!returnCombos.length) {
      setError("반품 가능한 거래가 없습니다.");
      return;
    }

    if (!isReturnCustomerSelected(returnForm.customer_id)) {
      setError("반품할 고객을 선택해주세요.");
      return;
    }

    if (!returnForm.product_id) {
      setError("반품할 상품을 선택해주세요.");
      return;
    }

    const combo = selectedReturnCombo;
    if (!combo) {
      setError("선택한 상품 정보를 찾을 수 없습니다.");
      return;
    }

    const qty = parseNumber(returnForm.qty);
    if (qty < 0) {
      setError("반품 미터는 0 이상이어야 합니다.");
      return;
    }
    if (qty === 0) {
      // 0은 변경 없이 통과: 폼만 초기화하고 종료
      setReturnForm(createEmptyReturnForm());
      return;
    }

    const maxQty = Math.round(combo.outstanding * 100) / 100; // 소수점 2자리 기준 비교
    if (qty - maxQty > 1e-6) {
      setError("반품 수량이 남은 수량을 초과했습니다.");
      return;
    }

    const payload = {
      product_id: combo.productId,
      customer_id: combo.customerId,
      qty,
      note: sanitizeNullable(returnForm.note),
      override_amount: returnForm.amount ? parseNumber(returnForm.amount) : null,
    };
    const result = await runAction(() => recordReturn(payload));
    if (result) {
      setReturnForm(createEmptyReturnForm());
    }
  };

  const handleStockSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stockForm.product_id) {
      setError("상품을 선택해주세요.");
      return;
    }
    const qty = parseNumber(stockForm.qty);
    if (qty <= 0) {
      setError("미터은 0보다 커야 합니다.");
      return;
    }
    const payload = {
      product_id: Number(stockForm.product_id),
      qty,
      kind: stockForm.kind,
      unit_price: stockForm.unit_price
        ? parseNumber(stockForm.unit_price)
        : null,
      counterparty: sanitizeNullable(stockForm.counterparty),
      customer_id: stockForm.customer_id ? Number(stockForm.customer_id) : null,
      note: sanitizeNullable(stockForm.note),
    };
    const result = await runAction(() => recordStockEntry(payload));
    if (result) {
      setStockForm(createEmptyStockForm());
    }
  };

  const handlePaymentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentForm.customer_id) {
      setError("결제할 고객을 선택해주세요.");
      return;
    }
    const amount = parseNumber(paymentForm.amount);
    if (amount <= 0) {
      setError("결제 금액은 0보다 커야 합니다.");
      return;
    }
    const payload = {
      customer_id: Number(paymentForm.customer_id),
      amount,
      note: sanitizeNullable(paymentForm.note),
    };
    const result = await runAction(() => recordCreditPayment(payload));
    if (result) {
      setPaymentForm(createEmptyPaymentForm());
    }
  };

  const handleExportLedger = () => {
    if (!filteredSales.length) {
      return;
    }
    const rows = filteredSales.map((sale) => [
      formatDateTime(sale.ts),
      sale.is_return ? "반품" : "판매",
      sale.customer_name ?? "일반 손님",
      sale.customer_phone ?? "",
      sale.product_name,
      (sale.is_return ? -sale.qty : sale.qty).toString(),
      sale.unit_price.toString(),
      (sale.is_return ? -sale.total_amount : sale.total_amount).toString(),
      sale.is_return
        ? sale.is_credit
          ? "외상 정산"
          : "반품 완료"
        : sale.is_credit
        ? "외상"
        : "완납",
      sale.note ?? "",
    ]);
    exportToCsv("ledger.csv", [
      [
        "날짜",
        "구분",
        "고객",
        "연락처",
        "상품",
        "미터",
        "단가",
        "금액",
        "상태",
        "비고",
      ],
      ...rows,
    ]);
  };

  const handleExportInventory = () => {
    if (!data) {
      return;
    }
    const rows = data.products.map((product) => [
      product.name,
      product.qty.toString(),
      product.unit_price.toString(),
      (product.qty * product.unit_price).toString(),
      product.low_stock_threshold.toString(),
      product.note ?? "",
    ]);
    exportToCsv("inventory.csv", [
      ["상품명", "재고", "단가", "재고 가치", "저재고 기준", "비고"],
      ...rows,
    ]);
  };

  const handleExportCredits = () => {
    if (!data) {
      return;
    }
    const rows = data.customer_balances.map((balance) => [
      balance.customer_name,
      balance.customer_phone ?? "",
      balance.total_credit.toString(),
      balance.total_paid.toString(),
      balance.outstanding.toString(),
      balance.last_activity ?? "",
    ]);
    exportToCsv("credits.csv", [
      ["고객", "연락처", "누적 외상", "결제액", "남은 잔액", "마지막 활동"],
      ...rows,
    ]);
  };

  const handleExportStock = () => {
    if (!data) {
      return;
    }
    const rows = data.stock_movements.map((movement) => [
      formatDateTime(movement.ts),
      movement.kind,
      movement.product_name,
      movement.qty.toString(),
      movement.unit_price?.toString() ?? "",
      movement.total_amount?.toString() ?? "",
      movement.customer_name ?? movement.counterparty ?? "",
      movement.note ?? "",
    ]);
    exportToCsv("stock-movements.csv", [
      [
        "일시",
        "구분",
        "상품",
        "미터",
        "단가",
        "총액",
        "거래처/고객",
        "비고",
      ],
      ...rows,
    ]);
  };

  const renderProducts = () => {
    if (!data) {
      return null;
    }
    const productPageSize = 5;
    const productQuery = productListQuery.trim().toLowerCase();
    const filteredProducts = productQuery
      ? data.products
          .filter((p) => p.name.toLowerCase().includes(productQuery))
          .slice()
          .sort((a, b) => {
            const an = a.name ?? "";
            const bn = b.name ?? "";
            const aStarts = an.toLowerCase().startsWith(productQuery);
            const bStarts = bn.toLowerCase().startsWith(productQuery);
            if (aStarts !== bStarts) {
              return aStarts ? -1 : 1; // 시작 일치 우선
            }
            return an.localeCompare(bn, "ko", { sensitivity: "base" });
          })
      : data.products;
    const totalProducts = filteredProducts.length;
    const totalProductPages = Math.max(1, Math.ceil(totalProducts / productPageSize));
    const currentProductPage = Math.min(productListPage, totalProductPages);
    const productStart = (currentProductPage - 1) * productPageSize;
    const pagedProducts = filteredProducts.slice(productStart, productStart + productPageSize);
    const pageSize = 10;
    const totalMovements = data.stock_movements.length;
    const totalMovementPages = Math.max(1, Math.ceil(totalMovements / pageSize));
    const currentMovementPage = Math.min(productStockPage, totalMovementPages);
    const movementStart = (currentMovementPage - 1) * pageSize;
    const pagedMovements: StockMovement[] = data.stock_movements.slice(
      movementStart,
      movementStart + pageSize,
    );
    const productFormPanel = (
      <div className="panel">
        <div className="panel-header">
          <h2>
            {productForm.mode === "create" ? "상품 등록" : "상품 수정"}
          </h2>
          {productForm.mode === "edit" && (
            <button
              type="button"
              className="ghost"
              onClick={() => setProductForm(createEmptyProductForm())}
              disabled={loading}
            >
              새 상품 추가로 전환
            </button>
          )}
        </div>
        <form onSubmit={handleProductSubmit} className="form-grid">
          <label>
            상품명
            <input
              type="text"
              value={productForm.name}
              onChange={(event) =>
                setProductForm((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              placeholder="상품명"
            />
          </label>
          {productForm.mode === "edit" && (
            <label>
              재고
              <input
                type="number"
                min="0"
                step="0.01"
                value={productForm.qty}
                onChange={(event) =>
                  setProductForm((prev) => ({
                    ...prev,
                    qty: event.target.value,
                  }))
                }
                placeholder="현재 재고"
              />
            </label>
          )}
          <label>
            미터당 단가 (원)
            <input
              type="number"
              min="0"
              step="0.01"
              value={productForm.unit_price}
              onChange={(event) =>
                setProductForm((prev) => ({
                  ...prev,
                  unit_price: event.target.value,
                }))
              }
            />
          </label>
          <label>
            저재고 기준
            <input
              type="number"
              min="0"
              step="1"
              value={productForm.low_stock_threshold}
              onChange={(event) =>
                setProductForm((prev) => ({
                  ...prev,
                  low_stock_threshold: event.target.value,
                }))
              }
            />
          </label>
          {productForm.mode === "create" && (
            <label>
              초기 재고
              <input
                type="number"
                min="0"
                step="0.01"
                value={productForm.initial_qty}
                onChange={(event) =>
                  setProductForm((prev) => ({
                    ...prev,
                    initial_qty: event.target.value,
                  }))
                }
                placeholder="선택 입력"
              />
            </label>
          )}
          <label className="span-2">
            메모
            <textarea
              value={productForm.note}
              onChange={(event) =>
                setProductForm((prev) => ({
                  ...prev,
                  note: event.target.value,
                }))
              }
              placeholder="예) 보관 위치, 유통기한 등"
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={loading}>
              {productForm.mode === "create" ? "상품 추가" : "수정 완료"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setProductForm(createEmptyProductForm())}
              disabled={loading}
            >
              초기화
            </button>
          </div>
        </form>
      </div>
    );
    return (
      <div className="tab-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>상품 목록</h2>
              <p className="subtitle">
                현재 {data.products.length}개의 상품을 관리하고 있습니다.
              </p>
            </div>
            <input
              type="text"
              value={productListQuery}
              onChange={(event) => {
                setProductListQuery(event.target.value);
                setProductListPage(1);
              }}
              placeholder="상품명 검색"
              style={{ maxWidth: "200px" }}
            />
            <button
              type="button"
              className="ghost"
              onClick={handleExportInventory}
            >
              CSV 내보내기
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>상품명</th>
                  <th>재고</th>
                  <th>미터당 단가</th>
                  <th>재고 가치</th>
                  <th>저재고 기준</th>
                  <th>비고</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {pagedProducts.map((product) => {
                  const isLowStock =
                    product.qty <= product.low_stock_threshold;
                  return (
                    <tr
                      key={product.id}
                      className={isLowStock ? "low-stock" : undefined}
                    >
                      <td>
                        <div className="cell-main">
                          <span>{product.name}</span>
                          {isLowStock && (
                            <span className="badge badge-critical">
                              저재고
                            </span>
                          )}
                        </div>
                      </td>
                      <td>{formatNumber(product.qty)}</td>
                      <td>{formatCurrency(product.unit_price)}</td>
                      <td>{formatCurrency(product.qty * product.unit_price)}</td>
                      <td>{formatNumber(product.low_stock_threshold)}</td>
                      <td>{product.note ?? "-"}</td>
                      <td className="actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleProductEdit(product)}
                          disabled={loading}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void handleProductDelete(product)}
                          disabled={loading}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setProductListPage((p) => Math.max(1, p - 1))}
              disabled={currentProductPage <= 1}
            >
              이전
            </button>
            <span style={{ margin: "0 8px" }}>
              페이지 {currentProductPage} / {totalProductPages}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setProductListPage((p) => Math.min(totalProductPages, p + 1))
              }
              disabled={currentProductPage >= totalProductPages}
            >
              다음
            </button>
          </div>

          {/* 저재고 알림 패널 제거 (상품 표 내부 배지 표시만 유지) */}
        </div>

        {productForm.mode === "edit" && productFormPanel}

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>입고 기록</h2>
              <p className="subtitle">
                입고(IN) 내역을 기록합니다.
              </p>
            </div>
          </div>
          <form onSubmit={handleStockSubmit} className="form-grid">
            <label>
              상품
              <input
                type="text"
                value={stockProductQuery}
                onChange={(event) => setStockProductQuery(event.target.value)}
                placeholder="상품명 검색"
              />
              <select
                value={stockForm.product_id}
                onChange={(event) =>
                  setStockForm((prev) => ({
                    ...prev,
                    product_id: event.target.value,
                  }))
                }
              >
                <option value="">상품 선택</option>
                {productListForStock.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              미터
              <input
                type="number"
                min="0"
                step="0.01"
                value={stockForm.qty}
                onChange={(event) =>
                  setStockForm((prev) => ({
                    ...prev,
                    qty: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              단가 (원)
              <input
                type="number"
                min="0"
                step="0.01"
                value={stockForm.unit_price}
                onChange={(event) =>
                  setStockForm((prev) => ({
                    ...prev,
                    unit_price: event.target.value,
                  }))
                }
                placeholder="선택 입력"
              />
            </label>
            <label>
              거래처
              <input
                type="text"
                value={stockForm.counterparty}
                onChange={(event) =>
                  setStockForm((prev) => ({
                    ...prev,
                    counterparty: event.target.value,
                  }))
                }
                placeholder="선택 입력"
              />
            </label>
            <label className="span-2">
              메모
              <textarea
                value={stockForm.note}
                onChange={(event) =>
                  setStockForm((prev) => ({
                    ...prev,
                    note: event.target.value,
                  }))
                }
                placeholder="비고"
              />
            </label>
            <div className="form-actions">
              <button type="submit" disabled={loading}>
                입고 기록
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setStockForm(createEmptyStockForm())}
                disabled={loading}
              >
                초기화
              </button>
            </div>
          </form>
        </div>

        {productForm.mode !== "edit" && productFormPanel}

        <div className="panel">
          <div className="panel-header">
            <h2>최근 입·출고 내역</h2>
            <p className="subtitle">페이지 {currentMovementPage} / {totalMovementPages}</p>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>일시</th>
                  <th>구분</th>
                  <th>상품</th>
                  <th>미터</th>
                  <th>단가</th>
                  <th>총액</th>
                  <th>거래처</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {pagedMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatDateTime(movement.ts)}</td>
                    <td>
                      {movement.kind === "IN" ? (
                        <span className="badge">입고</span>
                      ) : movement.kind === "OUT" ? (
                        <span className="badge badge-warning">출고</span>
                      ) : (
                        <span className="badge badge-return">반품</span>
                      )}
                    </td>
                    <td>{movement.product_name}</td>
                    <td>{formatNumber(movement.qty)}</td>
                    <td>
                      {movement.unit_price != null
                        ? formatCurrency(movement.unit_price)
                        : "-"}
                    </td>
                    <td>
                      {movement.total_amount != null
                        ? formatCurrency(movement.total_amount)
                        : "-"}
                    </td>
                    <td>
                      {movement.customer_name ??
                        movement.counterparty ??
                        "-"}
                    </td>
                    <td>{movement.note ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setProductStockPage((p) => Math.max(1, p - 1))}
              disabled={currentMovementPage <= 1}
            >
              이전
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setProductStockPage((p) => Math.min(totalMovementPages, p + 1))
              }
              disabled={currentMovementPage >= totalMovementPages}
            >
              다음
            </button>
            <button type="button" className="ghost" onClick={handleExportStock}>
              입출고 CSV 내보내기
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderCustomers = () => {
    if (!data) {
      return null;
    }
    return (
      <div className="tab-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>고객 목록</h2>
              <p className="subtitle">
                {data.customers.length}명의 고객 정보를 관리 중입니다.
              </p>
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>고객명</th>
                  <th>연락처</th>
                  <th>메모</th>
                  <th>외상 잔액</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((customer) => {
                  const balance = outstandingByCustomer.get(customer.id);
                  return (
                   <tr
                       key={customer.id}
                       className={
                         balance && balance.outstanding > 0
                           ? "credit-open"
                           : undefined
                       }
                     >
                       <td>
                         {formatNameWithPhone(customer.name, customer.phone)}
                       </td>
                       <td>{customer.phone ?? "-"}</td>
                      <td>{customer.note ?? "-"}</td>
                      <td>
                        {balance
                          ? formatCurrency(balance.outstanding)
                          : formatCurrency(0)}
                      </td>
                      <td className="actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => handleCustomerEdit(customer)}
                          disabled={loading}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void handleCustomerDelete(customer)}
                          disabled={loading}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>
              {customerForm.mode === "create" ? "고객 등록" : "고객 정보 수정"}
            </h2>
            {customerForm.mode === "edit" && (
              <button
                type="button"
                className="ghost"
                onClick={() => setCustomerForm(createEmptyCustomerForm())}
                disabled={loading}
              >
                새 고객 등록으로 전환
              </button>
            )}
          </div>
          <form onSubmit={handleCustomerSubmit} className="form-grid">
            <label>
              고객명
              <input
                type="text"
                value={customerForm.name}
                onChange={(event) =>
                  setCustomerForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              연락처
               <input
                 type="text"
                 value={customerForm.phone}
                 onChange={(event) =>
                   setCustomerForm((prev) => ({
                     ...prev,
                     phone: event.target.value,
                   }))
                 }
                 placeholder="연락처 (- 없이 입력 권장)"
                 required
               />
            </label>
            <label className="span-2">
              메모
              <textarea
                value={customerForm.note}
                onChange={(event) =>
                  setCustomerForm((prev) => ({
                    ...prev,
                    note: event.target.value,
                  }))
                }
                placeholder="거래 조건, 선호 등"
              />
            </label>
            <div className="form-actions">
              <button type="submit" disabled={loading}>
                {customerForm.mode === "create" ? "고객 추가" : "수정 완료"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setCustomerForm(createEmptyCustomerForm())}
                disabled={loading}
              >
                초기화
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const renderSales = () => {
    if (!data) {
      return null;
    }
    const recentSales = data.sales.slice(0, 20);
    return (
      <div className="tab-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>판매 등록</h2>
              <p className="subtitle">
                판매 시 재고 차감 및 외상 여부를 함께 기록합니다.
              </p>
            </div>
          </div>
          <form onSubmit={handleSaleSubmit} className="form-grid">
            <label>
              상품
              <input
                type="text"
                value={saleProductQuery}
                onChange={(event) => setSaleProductQuery(event.target.value)}
                placeholder="상품명/SKU 검색"
              />
              <select
                value={saleForm.product_id}
                onChange={(event) =>
                  setSaleForm((prev) => ({
                    ...prev,
                    product_id: event.target.value,
                    // 기본 금액을 미터 × 미터당 단가로 계산
                    amount:
                      (() => {
                        const p = (data?.products ?? []).find(
                          (product) => product.id === Number(event.target.value),
                        );
                        if (!p) return prev.amount;
                        const qtyNum = parseNumber(prev.qty || "0");
                        if (qtyNum > 0) {
                          return String(qtyNum * p.unit_price);
                        }
                        return prev.amount;
                      })(),
                  }))
                }
              >
                <option value="">상품 선택</option>
                {productListForSale.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              미터
              <input
                type="number"
                min="0"
                step="0.01"
                value={saleForm.qty}
                onChange={(event) =>
                  setSaleForm((prev) => {
                    const nextQty = event.target.value;
                    const qtyNum = parseNumber(nextQty || "0");
                    const product = data.products.find(
                      (p) => p.id === Number(prev.product_id),
                    );
                    const autoAmount =
                      product && qtyNum > 0
                        ? String(qtyNum * product.unit_price)
                        : prev.amount;
                    return { ...prev, qty: nextQty, amount: autoAmount };
                  })
                }
              />
            </label>
            <label>
              금액 (원)
              <input
                type="number"
                min="0"
                step="0.01"
                value={saleForm.amount}
                onChange={(event) =>
                  setSaleForm((prev) => ({
                    ...prev,
                    amount: event.target.value,
                  }))
                }
                placeholder="미터 × 미터당 단가"
              />
            </label>
            <label>
              고객 (선택)
              <input
                type="text"
                value={saleCustomerQuery}
                onChange={(event) => setSaleCustomerQuery(event.target.value)}
                placeholder="이름/연락처 검색"
              />
              <select
                value={saleForm.customer_id}
                onChange={(event) =>
                  setSaleForm((prev) => ({
                    ...prev,
                    customer_id: event.target.value,
                  }))
                }
              >
                <option value="">일반 손님</option>
                {customerListForSale.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {formatNameWithPhone(customer.name, customer.phone)}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={saleForm.is_credit}
                onChange={(event) =>
                  setSaleForm((prev) => ({
                    ...prev,
                    is_credit: event.target.checked,
                  }))
                }
              />
              외상 거래로 기록
            </label>
            <label className="span-2">
              비고
              <textarea
                value={saleForm.note}
                onChange={(event) =>
                  setSaleForm((prev) => ({
                    ...prev,
                    note: event.target.value,
                  }))
                }
                placeholder="메모"
              />
            </label>
            <div className="form-actions">
              <button type="submit" disabled={loading}>
                판매 등록
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setSaleForm(createEmptySaleForm())}
                disabled={loading}
              >
                초기화
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>반품 등록</h2>
              <p className="subtitle">
                남은 필름을 반품 처리하면 재고와 외상 잔액이 자동으로 조정돼요.
              </p>
            </div>
          </div>
          {returnCombos.length === 0 ? (
            <div className="notice">
              반품 가능한 거래가 없습니다. 새 판매를 등록한 뒤 반품할 수 있어요.
            </div>
          ) : (
            <form onSubmit={handleReturnSubmit} className="form-grid">
              <label>
                고객
                <select
                  value={returnForm.customer_id}
                  onChange={(event) => {
                    const value = event.target.value;
                    setReturnForm((prev) => ({
                      customer_id: value,
                      product_id: "",
                      qty: "",
                      note: prev.note,
                      amount: prev.amount,
                    }));
                  }}
                >
                  <option value="">고객 선택</option>
                  {returnCustomerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!isReturnCustomerSelected(returnForm.customer_id) && (
                  <span className="form-hint">
                    반품할 고객을 먼저 선택해주세요.
                  </span>
                )}
              </label>
              <label>
                상품
                <select
                  value={returnForm.product_id}
                  disabled={!isReturnCustomerSelected(returnForm.customer_id)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setReturnForm((prev) => {
                      if (!value) {
                        return {
                          ...prev,
                          product_id: "",
                          qty: "",
                        };
                      }
                      const productId = Number(value);
                      if (!Number.isFinite(productId)) {
                        return {
                          ...prev,
                          product_id: "",
                          qty: "",
                        };
                      }
                      const matchingCombo = returnCombos.find(
                        (combo) =>
                          combo.productId === productId &&
                          matchesReturnCustomer(combo.customerId, prev.customer_id),
                      );
                      if (!matchingCombo) {
                        return {
                          ...prev,
                          product_id: value,
                          qty: "",
                        };
                      }
                      const defaultQty = matchingCombo.outstanding.toString();
                      const shouldResetQty =
                        prev.product_id !== value || !prev.qty;
                      return {
                        ...prev,
                        product_id: value,
                        qty: shouldResetQty ? defaultQty : prev.qty,
                      };
                    });
                  }}
                >
                  <option value="">상품 선택</option>
                  {productOptions.map((option) => (
                    <option key={option.productId} value={option.productId}>
                      {`${option.productName} (남은 ${formatNumber(option.outstanding)}m)`}
                    </option>
                  ))}
                </select>
                {selectedReturnCombo && (
                  <span className="form-hint">
                    남은 수량 {formatNumber(selectedReturnCombo.outstanding)}m
                  </span>
                )}
              </label>
              <label>
                반품 미터
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={returnForm.qty}
                  onChange={(event) =>
                    setReturnForm((prev) => {
                      const nextQty = event.target.value;
                      const qtyNum = parseNumber(nextQty || "0");
                      const combo = selectedReturnCombo;
                      const autoAmount = combo && qtyNum > 0
                        ? String(
                            combo.saleEntries.reduce((sum, e) => {
                              const portion = Math.min(qtyNum - (sum > 0 ? 0 : 0), e.remaining);
                              return sum + (portion > 0 ? portion * e.sale.unit_price : 0);
                            }, 0),
                          )
                        : prev.amount;
                      return { ...prev, qty: nextQty, amount: autoAmount };
                    })
                  }
                />
              </label>
              <label>
                반품 금액 (원)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={returnForm.amount}
                  onChange={(event) =>
                    setReturnForm((prev) => ({ ...prev, amount: event.target.value }))
                  }
                  placeholder="자동 계산 또는 직접 입력"
                />
              </label>
              <label>
                메모
                <textarea
                  value={returnForm.note}
                  onChange={(event) =>
                    setReturnForm((prev) => ({ ...prev, note: event.target.value }))
                  }
                  placeholder="예) 미사용분 반납"
                />
              </label>
              {selectedReturnCombo && (
                <div className="return-summary span-2">
                  <span>
                    남은 미터 {formatNumber(selectedReturnCombo.outstanding)}m
                  </span>
                  <span>반품 금액 {formatCurrency(previewReturnAmount)}</span>
                </div>
              )}
              {selectedReturnCombo && (
                <div className="span-2">
                  <span className="form-hint">
                    가장 오래된 거래부터 순서대로 반품 처리돼요.
                  </span>
                  <ul className="bullet-list">
                    {selectedReturnCombo.saleEntries.map(({ sale, remaining }) => (
                      <li key={sale.id}>
                        {`${formatDateTime(sale.ts)} · 남은 ${formatNumber(remaining)}m`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="form-actions">
                <button type="submit" disabled={loading}>
                  반품 등록
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setReturnForm(createEmptyReturnForm())}
                  disabled={loading}
                >
                  초기화
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>최근 판매 내역</h2>
            <p className="subtitle">최신 {recentSales.length}건 표시</p>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>일시</th>
                  <th>구분</th>
                  <th>상품</th>
                  <th>고객</th>
                  <th>미터</th>
                  <th>금액</th>
                  <th>상태</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className={
                      sale.is_return
                        ? "return-row"
                        : sale.is_credit
                        ? "credit-row"
                        : undefined
                    }
                  >
                    <td>{formatDateTime(sale.ts)}</td>
                    <td>
                      {sale.is_return ? (
                        <span className="badge badge-return">반품</span>
                      ) : (
                        <span className="badge">판매</span>
                      )}
                    </td>
                    <td>{sale.product_name}</td>
                    <td>
                      {sale.customer_name && sale.customer_name.trim()
                        ? formatNameWithPhone(sale.customer_name, sale.customer_phone)
                        : "일반 손님"}
                    </td>
                    <td>{formatNumber(sale.is_return ? -sale.qty : sale.qty)}</td>
                    <td>{formatCurrency(sale.is_return ? -sale.total_amount : sale.total_amount)}</td>
                    <td>
                      {sale.is_return ? (
                        sale.is_credit ? (
                          <span className="badge badge-credit">외상 정산</span>
                        ) : (
                          <span className="badge">반품 완료</span>
                        )
                      ) : sale.is_credit ? (
                        <span className="badge badge-credit">외상</span>
                      ) : (
                        <span className="badge">완납</span>
                      )}
                    </td>
                    <td>{sale.note ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // (입·출고 탭은 상품 탭으로 통합되었습니다)

  const renderLedger = () => {
    if (!data) {
      return null;
    }
    return (
      <div className="tab-layout">
        <div className="panel">
          <div className="panel-header">
            <h2>장부 검색</h2>
            <p className="subtitle">날짜, 고객, 상품으로 필터링하세요.</p>
          </div>
          <div className="form-grid">
            <label>
              시작일
              <input
                type="date"
                value={ledgerFilter.startDate}
                onChange={(event) =>
                  setLedgerFilter((prev) => ({
                    ...prev,
                    startDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              종료일
              <input
                type="date"
                value={ledgerFilter.endDate}
                onChange={(event) =>
                  setLedgerFilter((prev) => ({
                    ...prev,
                    endDate: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              고객 검색
              <input
                type="text"
                value={ledgerFilter.customer}
                onChange={(event) =>
                  setLedgerFilter((prev) => ({
                    ...prev,
                    customer: event.target.value,
                  }))
                }
                placeholder="고객명/연락처 검색"
                list="ledger-customer-suggestions"
              />
              <datalist id="ledger-customer-suggestions">
                {(data?.customers ?? [])
                  .filter((c) => {
                    const q = ledgerFilter.customer.trim().toLowerCase();
                    if (!q) return false;
                    return (
                      c.name.toLowerCase().includes(q) ||
                      ((c.phone ?? "").toLowerCase().includes(q))
                    );
                  })
                  .slice(0, 10)
                  .map((c) => (
                    <option
                      key={c.id}
                      value={formatNameWithPhone(c.name, c.phone)}
                    />
                  ))}
              </datalist>
            </label>
            <label>
              상품 검색
              <input
                type="text"
                value={ledgerFilter.product}
                onChange={(event) =>
                  setLedgerFilter((prev) => ({
                    ...prev,
                    product: event.target.value,
                  }))
                }
                placeholder="상품명 검색"
                list="ledger-product-suggestions"
              />
              <datalist id="ledger-product-suggestions">
                {(data?.products ?? [])
                  .filter((p) => {
                    const q = ledgerFilter.product.trim().toLowerCase();
                    if (!q) return false;
                    return p.name.toLowerCase().includes(q);
                  })
                  .slice(0, 10)
                  .map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
              </datalist>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={ledgerFilter.onlyCredit}
                onChange={(event) =>
                  setLedgerFilter((prev) => ({
                    ...prev,
                    onlyCredit: event.target.checked,
                  }))
                }
              />
              외상 거래만 보기
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setLedgerFilter(createEmptyLedgerFilter())}
              >
                필터 초기화
              </button>
              <button type="button" onClick={handleExportLedger}>
                CSV 내보내기
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="summary-grid">
            <div className="summary-card">
              <span className="summary-label">총 판매 금액</span>
              <strong>{formatCurrency(ledgerTotals.total)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">총 판매 미터</span>
              <strong>{formatNumber(ledgerTotals.qty)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">외상 금액</span>
              <strong>{formatCurrency(ledgerTotals.credit)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">미수 잔액 합계</span>
              <strong>
                {formatCurrency(
                  data.customer_balances.reduce(
                    (sum, balance) => sum + Math.max(balance.outstanding, 0),
                    0,
                  ),
                )}
              </strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>고객별 합계</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>고객</th>
                  <th>총 미터</th>
                  <th>총 금액</th>
                  <th>외상 금액</th>
                  <th>남은 잔액</th>
                </tr>
              </thead>
              <tbody>
                {ledgerSummary.map((row) => {
                  const balance =
                    row.customerId != null
                      ? outstandingByCustomer.get(row.customerId)
                      : null;
                  return (
                    <tr
                      key={row.key}
                      className={
                        balance && balance.outstanding > 0
                          ? "credit-open"
                          : undefined
                      }
                    >
                     <td>
                       {formatNameWithPhone(row.name, row.phone)}
                     </td>
                      <td>{formatNumber(row.qty)}</td>
                      <td>{formatCurrency(row.total)}</td>
                      <td>{formatCurrency(row.credit)}</td>
                      <td>{formatCurrency(balance?.outstanding ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>상세 내역</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>일시</th>
                  <th>구분</th>
                  <th>고객</th>
                  <th>상품</th>
                  <th>미터</th>
                  <th>단가</th>
                  <th>금액</th>
                  <th>상태</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => (
                  <tr
                    key={sale.id}
                    className={
                      sale.is_return
                        ? "return-row"
                        : sale.is_credit
                        ? "credit-row"
                        : undefined
                    }
                  >
                    <td>{formatDateTime(sale.ts)}</td>
                    <td>
                      {sale.is_return ? (
                        <span className="badge badge-return">반품</span>
                      ) : (
                        <span className="badge">판매</span>
                      )}
                    </td>
                    <td>
                      {sale.customer_name && sale.customer_name.trim()
                        ? formatNameWithPhone(sale.customer_name, sale.customer_phone)
                        : "일반 손님"}
                    </td>
                    <td>{sale.product_name}</td>
                    <td>{formatNumber(sale.is_return ? -sale.qty : sale.qty)}</td>
                    <td>{formatCurrency(sale.unit_price)}</td>
                    <td>{formatCurrency(sale.is_return ? -sale.total_amount : sale.total_amount)}</td>
                    <td>
                      {sale.is_return ? (
                        sale.is_credit ? (
                          <span className="badge badge-credit">외상 정산</span>
                        ) : (
                          <span className="badge">반품 완료</span>
                        )
                      ) : sale.is_credit ? (
                        <span className="badge badge-credit">외상</span>
                      ) : (
                        <span className="badge">완납</span>
                      )}
                    </td>
                    <td>{sale.note ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderCredit = () => {
    if (!data) {
      return null;
    }
    return (
      <div className="tab-layout">
        <div className="panel">
          <div className="panel-header">
            <h2>외상 결제 등록</h2>
            <p className="subtitle">고객별 결제 내역을 기록합니다.</p>
          </div>
          <form onSubmit={handlePaymentSubmit} className="form-grid">
            <label>
              고객
              <input
                type="text"
                value={creditCustomerQuery}
                onChange={(event) => setCreditCustomerQuery(event.target.value)}
                placeholder="이름(1234) 또는 이름/연락처 검색"
              />
              <select
                value={paymentForm.customer_id}
                onChange={(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    customer_id: event.target.value,
                  }))
                }
              >
                <option value="">고객 선택</option>
                {outstandingCustomersFiltered.map((balance) => (
                  <option key={balance.customer_id} value={balance.customer_id}>
                    {formatNameWithPhone(
                      balance.customer_name,
                      balance.customer_phone,
                    )}{" "}
                    (미수 {formatCurrency(balance.outstanding)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              결제 금액
              <input
                type="number"
                min="0"
                step="0.01"
                value={paymentForm.amount}
                onChange={(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    amount: event.target.value,
                  }))
                }
              />
            </label>
            <label className="span-2">
              메모
              <textarea
                value={paymentForm.note}
                onChange={(event) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    note: event.target.value,
                  }))
                }
                placeholder="결제 수단 등"
              />
            </label>
            <div className="form-actions">
              <button type="submit" disabled={loading}>
                결제 기록
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setPaymentForm(createEmptyPaymentForm())}
                disabled={loading}
              >
                초기화
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>고객별 미수 현황</h2>
            <p className="subtitle">
              현재 미수 총액{" "}
              {formatCurrency(
                outstandingCustomers.reduce(
                  (sum, balance) => sum + balance.outstanding,
                  0,
                ),
              )}
            </p>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>고객</th>
                  <th>누적 외상</th>
                  <th>결제액</th>
                  <th>남은 잔액</th>
                  <th>마지막 활동</th>
                </tr>
              </thead>
              <tbody>
                {data.customer_balances.map((balance) => (
                  <tr
                    key={balance.customer_id}
                    className={
                      balance.outstanding > 0 ? "credit-open" : undefined
                    }
                  >
                    <td>
                      {formatNameWithPhone(
                        balance.customer_name,
                        balance.customer_phone,
                      )}
                    </td>
                    <td>{formatCurrency(balance.total_credit)}</td>
                    <td>{formatCurrency(balance.total_paid)}</td>
                    <td>{formatCurrency(balance.outstanding)}</td>
                    <td>
                      {balance.last_activity
                        ? formatDateTime(balance.last_activity)
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="ghost" onClick={handleExportCredits}>
            CSV 내보내기
          </button>
        </div>

        <div className="panel">
          <h2>외상/결제 히스토리</h2>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>일시</th>
                  <th>고객</th>
                  <th>유형</th>
                  <th>금액</th>
                  <th>관련 판매</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {data.credits.slice(0, 50).map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.ts)}</td>
                    <td>
                      {formatNameWithPhone(
                        entry.customer_name,
                        entry.customer_phone,
                      )}
                    </td>
                    <td>
                      {entry.is_payment ? (
                        <span className="badge">결제</span>
                      ) : (
                        <span className="badge badge-credit">외상</span>
                      )}
                    </td>
                    <td>{formatCurrency(entry.amount)}</td>
                    <td>{entry.sale_id ?? "-"}</td>
                    <td>{entry.note ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderReports = () => {
    if (!data) {
      return null;
    }
    return (
      <div className="tab-layout">
        <div className="panel">
          <h2>요약 리포트</h2>
          <div className="summary-grid">
            <div className="summary-card">
              <span className="summary-label">재고 자산 가치</span>
              <strong>{formatCurrency(totalInventoryValue)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">상품 수</span>
              <strong>{formatNumber(data.products.length)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">고객 수</span>
              <strong>{formatNumber(data.customers.length)}</strong>
            </div>
            <div className="summary-card">
              <span className="summary-label">외상 잔액</span>
              <strong>
                {formatCurrency(
                  data.customer_balances.reduce(
                    (sum, balance) => sum + Math.max(balance.outstanding, 0),
                    0,
                  ),
                )}
              </strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>월별 매출</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>월</th>
                  <th>완불 금액</th>
                  <th>외상 매출</th>
                  <th>미납 금액</th>
                  <th>총 매출</th>
                </tr>
              </thead>
              <tbody>
                {monthlySales.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{formatCurrency(row.paid)}</td>
                    <td>{formatCurrency(row.credit)}</td>
                    <td>{formatCurrency(row.outstanding)}</td>
                    <td>{formatCurrency(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>우수 고객</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>고객</th>
                  <th>누적 매출</th>
                  <th>외상 매출</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((row) => (
                  <tr key={row.id ?? row.name}>
                    <td>{formatNameWithPhone(row.name, row.phone)}</td>
                    <td>{formatCurrency(row.total)}</td>
                    <td>{formatCurrency(row.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>저재고 알림</h3>
          {lowStockProducts.length ? (
            <ul className="bullet-list">
              {lowStockProducts.map((product) => (
                <li key={product.id}>
                  <strong>{product.name}</strong> — 현재 재고{" "}
                  {formatNumber(product.qty)} (기준{" "}
                  {formatNumber(product.low_stock_threshold)})
                </li>
              ))}
            </ul>
          ) : (
            <p>모든 상품의 재고가 기준 이상입니다.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell" aria-busy={loading}>
      <header className="app-header">
        <div>
          <h1>Inventory Ledger Pro+</h1>
          <p className="subtitle">
            소상공인 맞춤 장부 · 재고 · 외상 관리 솔루션
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="ghost"
            onClick={() => void runAction(fetchAppData)}
            disabled={loading}
          >
            새로고침
          </button>
        </div>
      </header>

      <nav className="tab-bar">
        {[
          { key: "products", label: "상품" },
          { key: "customers", label: "고객" },
          { key: "sales", label: "판매" },
          { key: "ledger", label: "장부" },
          { key: "credit", label: "외상" },
          { key: "reports", label: "보고서" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? "tab-button active" : "tab-button"}
            onClick={() => setTab(item.key as TabKey)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error && <div className="error-banner">{error}</div>}

      {!data && !loading && (
        <div className="empty-state">
          데이터를 불러오는 중 문제가 발생했습니다.
        </div>
      )}

      {data && (
        <main className="tab-content">
          {tab === "products" && renderProducts()}
          {tab === "customers" && renderCustomers()}
          {tab === "sales" && renderSales()}
          {tab === "ledger" && renderLedger()}
          {tab === "credit" && renderCredit()}
          {tab === "reports" && renderReports()}
        </main>
      )}

      {loading && <div className="loading-indicator">처리 중...</div>}

      {pendingDeleteProduct && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="panel"
            style={{ maxWidth: 480, width: "90%", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}
          >
            <div className="panel-header">
              <h2>상품 삭제 확인</h2>
            </div>
            <div style={{ padding: "12px 16px" }}>
              <p>
                <strong>{pendingDeleteProduct.name}</strong> 상품을 삭제하시겠습니까?
              </p>
              <p className="subtitle">
                삭제 후에도 기존 판매/입고/반품 기록은 그대로 남습니다.
              </p>
            </div>
            <div className="form-actions" style={{ padding: "0 16px 16px" }}>
              <button
                type="button"
                className="danger"
                onClick={() => void confirmProductDelete()}
                disabled={loading}
              >
                삭제
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setPendingDeleteProduct(null)}
                disabled={loading}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function phoneTail(phone: string | null): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 4) {
    return digits.slice(-4);
  }
  const trimmed = phone.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(-4);
}

function formatNameWithPhone(
  name: string | null,
  phone: string | null,
): string {
  const base = name?.trim() ? name : "일반 손님";
  const tail = phoneTail(phone);
  if (!tail) {
    return base;
  }
  return `${base} (${tail})`;
}

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("ko-KR", {
    maximumFractionDigits: digits > 0 ? digits : 2,
    minimumFractionDigits: digits,
  });
}

function formatCurrency(value: number): string {
  return value.toLocaleString("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("ko-KR");
}

async function exportToCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = cell ?? "";
          if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
            return `"${safe.replace(/"/g, '""')}"`;
          }
          return safe;
        })
        .join(","),
    )
    .join("\n");
  // If running in Tauri, save via backend to a real file location
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tauri = (window as any)?.__TAURI__;
    if (tauri?.core?.invoke) {
      // invoke returns the saved path string
      const savedPath = await tauri.core.invoke("save_csv", { filename, content: csv });
      // 간단 알림
      // eslint-disable-next-line no-alert
      alert(`CSV 저장 완료\n${savedPath}`);
      return;
    }
  } catch {
    // fall through to web download
  }

  // Web fallback: trigger browser download
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default App;
