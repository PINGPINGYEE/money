import { invoke } from "@tauri-apps/api/core";
import type {
  AppData,
  CreditEntry,
  CreditPaymentPayload,
  Customer,
  CustomerBalance,
  CustomerFormPayload,
  CustomerUpdatePayload,
  Product,
  ProductFormPayload,
  ProductUpdatePayload,
  SalePayload,
  ReturnPayload,
  ReturnUpdatePayload,
  StockEntryPayload,
  StockMovement,
  SaleUpdatePayload,
} from "./types";

// Detect if running inside Tauri. In pure web, fallback to localStorage mock.
function isTauri(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tauri = (window as any)?.__TAURI__;
    return !!tauri?.core?.invoke;
  } catch {
    return false;
  }
}

// ------------------------------
// Local mock storage (web demo)
// ------------------------------
const STORAGE_KEY = "ilpp.local.state.v1";
const ID_KEY = "ilpp.local.ids.v1";

type CanonicalState = {
  products: Product[];
  customers: Customer[];
  sales: Array<{
    id: number;
    ts: string;
    product_id: number;
    product_name: string;
    qty: number;
    unit_price: number;
    total_amount: number;
    customer_id: number | null;
    customer_name: string | null;
    customer_phone: string | null;
    note: string | null;
    is_credit: boolean;
    is_return: boolean;
    origin_sale_id: number | null;
  }>;
  stock_movements: StockMovement[];
  credits: CreditEntry[];
};

type IdCounters = {
  product: number;
  customer: number;
  sale: number;
  stock: number;
  credit: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function readIds(): IdCounters {
  const raw = localStorage.getItem(ID_KEY);
  if (raw) return JSON.parse(raw) as IdCounters;
  const init: IdCounters = { product: 1, customer: 1, sale: 1, stock: 1, credit: 1 };
  localStorage.setItem(ID_KEY, JSON.stringify(init));
  return init;
}

function bumpId<K extends keyof IdCounters>(key: K): number {
  const ids = readIds();
  const next = ids[key];
  const updated = { ...ids, [key]: next + 1 };
  localStorage.setItem(ID_KEY, JSON.stringify(updated));
  return next;
}

function loadState(): CanonicalState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw) as CanonicalState;

  // Seed minimal demo data
  const p1Id = bumpId("product");
  const p2Id = bumpId("product");
  const c1Id = bumpId("customer");

  const seed: CanonicalState = {
    products: [
      {
        id: p1Id,
        name: "PET 투명 필름",
        sku: "PET-CLR",
        unit_price: 3500,
        qty: 120,
        note: null,
        low_stock_threshold: 30,
        created_at: nowIso(),
      },
      {
        id: p2Id,
        name: "블랙 매트 필름",
        sku: "BLK-MAT",
        unit_price: 4200,
        qty: 80,
        note: null,
        low_stock_threshold: 20,
        created_at: nowIso(),
      },
    ],
    customers: [
      {
        id: c1Id,
        name: "홍길동",
        phone: "01012345678",
        note: null,
        created_at: nowIso(),
      },
    ],
    sales: [],
    stock_movements: [],
    credits: [],
  };

  // Seed one sale (credit)
  const unitPrice = 4200;
  const qty = 5;
  const saleId = bumpId("sale");
  seed.sales.push({
    id: saleId,
    ts: nowIso(),
    product_id: p2Id,
    product_name: "블랙 매트 필름",
    qty,
    unit_price: unitPrice,
    total_amount: unitPrice * qty,
    customer_id: c1Id,
    customer_name: "홍길동",
    customer_phone: "01012345678",
    note: null,
    is_credit: true,
    is_return: false,
    origin_sale_id: null,
  });
  const stockId = bumpId("stock");
  seed.stock_movements.push({
    id: stockId,
    ts: nowIso(),
    kind: "OUT",
    product_id: p2Id,
    product_name: "블랙 매트 필름",
    qty,
    unit_price: unitPrice,
    total_amount: unitPrice * qty,
    counterparty: null,
    customer_id: c1Id,
    customer_name: "홍길동",
    note: "웹 데모 시드",
    sale_id: saleId,
  });
  const creditId = bumpId("credit");
  seed.credits.push({
    id: creditId,
    ts: nowIso(),
    customer_id: c1Id,
    customer_name: "홍길동",
    customer_phone: "01012345678",
    sale_id: saleId,
    amount: unitPrice * qty,
    is_payment: false,
    note: "외상 발생 (웹 데모)",
  });
  // Decrease stock
  const p2 = seed.products.find((p) => p.id === p2Id)!;
  p2.qty -= qty;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
  return seed;
}

function saveState(state: CanonicalState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function computeBalances(state: CanonicalState): CustomerBalance[] {
  const map = new Map<number, CustomerBalance>();
  state.customers.forEach((c) => {
    map.set(c.id, {
      customer_id: c.id,
      customer_name: c.name,
      customer_phone: c.phone,
      total_credit: 0,
      total_paid: 0,
      outstanding: 0,
      last_activity: null,
    });
  });
  state.credits.forEach((cr) => {
    const entry = map.get(cr.customer_id);
    if (!entry) return;
    if (cr.is_payment) entry.total_paid += cr.amount;
    else entry.total_credit += cr.amount;
    if (!entry.last_activity || entry.last_activity < cr.ts) {
      entry.last_activity = cr.ts;
    }
  });
  for (const entry of map.values()) {
    entry.outstanding = Math.max(entry.total_credit - entry.total_paid, 0);
  }
  return Array.from(map.values());
}

function materialize(state: CanonicalState): AppData {
  return {
    products: [...state.products].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    customers: [...state.customers].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    sales: [...state.sales].sort((a, b) => (a.ts < b.ts ? 1 : -1)),
    stock_movements: [...state.stock_movements].sort((a, b) => (a.ts < b.ts ? 1 : -1)),
    credits: [...state.credits].sort((a, b) => (a.ts < b.ts ? 1 : -1)),
    customer_balances: computeBalances(state),
  };
}

async function local_get_app_data(): Promise<AppData> {
  return materialize(loadState());
}

async function local_create_product(payload: ProductFormPayload): Promise<AppData> {
  const state = loadState();
  const id = bumpId("product");
  const product: Product = {
    id,
    name: payload.name,
    sku: payload.sku ?? null,
    unit_price: payload.unit_price,
    qty: 0,
    note: payload.note ?? null,
    low_stock_threshold: payload.low_stock_threshold ?? 0,
    created_at: nowIso(),
  };
  const initialQty = payload.initial_qty ?? null;
  if (initialQty && initialQty > 0) {
    product.qty = initialQty;
    const stockId = bumpId("stock");
    state.stock_movements.unshift({
      id: stockId,
      ts: nowIso(),
      kind: "IN",
      product_id: id,
      product_name: payload.name,
      qty: initialQty,
      unit_price: null,
      total_amount: null,
      counterparty: null,
      customer_id: null,
      customer_name: null,
      note: "초기 재고",
      sale_id: null,
    });
  }
  state.products.unshift(product);
  saveState(state);
  return materialize(state);
}

async function local_update_product(payload: ProductUpdatePayload): Promise<AppData> {
  const state = loadState();
  const target = state.products.find((p) => p.id === payload.id);
  if (!target) return materialize(state);
  target.name = payload.name;
  target.sku = payload.sku ?? null;
  target.unit_price = payload.unit_price;
  target.note = payload.note ?? null;
  target.low_stock_threshold = payload.low_stock_threshold ?? 0;
  saveState(state);
  return materialize(state);
}

async function local_delete_product(productId: number): Promise<AppData> {
  const state = loadState();
  state.products = state.products.filter((p) => p.id !== productId);
  state.sales = state.sales.filter((s) => s.product_id !== productId);
  state.stock_movements = state.stock_movements.filter((m) => m.product_id !== productId);
  saveState(state);
  return materialize(state);
}

async function local_create_customer(payload: CustomerFormPayload): Promise<AppData> {
  const state = loadState();
  const id = bumpId("customer");
  const customer: Customer = {
    id,
    name: payload.name,
    phone: payload.phone,
    note: payload.note ?? null,
    created_at: nowIso(),
  };
  state.customers.unshift(customer);
  saveState(state);
  return materialize(state);
}

async function local_update_customer(payload: CustomerUpdatePayload): Promise<AppData> {
  const state = loadState();
  const target = state.customers.find((c) => c.id === payload.id);
  if (!target) return materialize(state);
  target.name = payload.name;
  target.phone = payload.phone;
  target.note = payload.note ?? null;
  // Also update denormalized names for existing records
  state.sales.forEach((s) => {
    if (s.customer_id === payload.id) {
      s.customer_name = payload.name;
      s.customer_phone = payload.phone;
    }
  });
  state.credits.forEach((cr) => {
    if (cr.customer_id === payload.id) {
      cr.customer_name = payload.name;
      cr.customer_phone = payload.phone;
    }
  });
  saveState(state);
  return materialize(state);
}

async function local_delete_customer(customerId: number): Promise<AppData> {
  const state = loadState();
  state.customers = state.customers.filter((c) => c.id !== customerId);
  state.sales.forEach((s) => {
    if (s.customer_id === customerId) {
      s.customer_id = null;
      s.customer_name = null;
      s.customer_phone = null;
    }
  });
  state.credits = state.credits.filter((cr) => cr.customer_id !== customerId);
  saveState(state);
  return materialize(state);
}

async function local_record_stock_entry(payload: StockEntryPayload): Promise<AppData> {
  const state = loadState();
  const product = state.products.find((p) => p.id === payload.product_id);
  if (!product) return materialize(state);
  const qty = payload.qty;
  const kind = payload.kind ?? "IN";
  const sign = kind === "IN" ? 1 : -1;
  product.qty = Math.max(product.qty + sign * qty, 0);
  const id = bumpId("stock");
  state.stock_movements.unshift({
    id,
    ts: nowIso(),
    kind,
    product_id: product.id,
    product_name: product.name,
    qty,
    unit_price: payload.unit_price ?? null,
    total_amount: payload.unit_price != null ? payload.unit_price * qty : null,
    counterparty: payload.counterparty ?? null,
    customer_id: payload.customer_id ?? null,
    customer_name:
      payload.customer_id != null
        ? state.customers.find((c) => c.id === payload.customer_id)?.name ?? null
        : null,
    note: payload.note ?? null,
    sale_id: null,
  });
  saveState(state);
  return materialize(state);
}

async function local_record_sale(payload: SalePayload): Promise<AppData> {
  const state = loadState();
  const product = state.products.find((p) => p.id === payload.product_id);
  if (!product) return materialize(state);
  const qty = payload.qty;
  const unitPrice = payload.unit_price ?? product.unit_price;
  const total = unitPrice * qty;
  // Adjust stock
  product.qty = Math.max(product.qty - qty, 0);
  // Create sale
  const saleId = bumpId("sale");
  state.sales.unshift({
    id: saleId,
    ts: nowIso(),
    product_id: product.id,
    product_name: product.name,
    qty,
    unit_price: unitPrice,
    total_amount: total,
    customer_id: payload.customer_id ?? null,
    customer_name:
      payload.customer_id != null
        ? state.customers.find((c) => c.id === payload.customer_id)?.name ?? null
        : null,
    customer_phone:
      payload.customer_id != null
        ? state.customers.find((c) => c.id === payload.customer_id)?.phone ?? null
        : null,
    note: payload.note ?? null,
    is_credit: !!payload.is_credit,
    is_return: false,
    origin_sale_id: null,
  });
  // Stock movement
  const stockId = bumpId("stock");
  state.stock_movements.unshift({
    id: stockId,
    ts: nowIso(),
    kind: "OUT",
    product_id: product.id,
    product_name: product.name,
    qty,
    unit_price: unitPrice,
    total_amount: total,
    counterparty: null,
    customer_id: payload.customer_id ?? null,
    customer_name:
      payload.customer_id != null
        ? state.customers.find((c) => c.id === payload.customer_id)?.name ?? null
        : null,
    note: payload.note ?? null,
    sale_id: saleId,
  });
  // Credit entry if credit sale
  if (payload.is_credit && payload.customer_id != null) {
    const creditId = bumpId("credit");
    const customer = state.customers.find((c) => c.id === payload.customer_id)!;
    state.credits.unshift({
      id: creditId,
      ts: nowIso(),
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      sale_id: saleId,
      amount: total,
      is_payment: false,
      note: payload.note ?? null,
    });
  }
  saveState(state);
  return materialize(state);
}

async function local_record_return(payload: ReturnPayload): Promise<AppData> {
  const state = loadState();
  const product = state.products.find((p) => p.id === payload.product_id);
  if (!product) return materialize(state);
  const qty = payload.qty;
  // Restock
  product.qty = product.qty + qty;
  const unitPrice = payload.override_amount != null ? payload.override_amount / qty : product.unit_price;
  const total = unitPrice * qty;
  const saleId = bumpId("sale");
  state.sales.unshift({
    id: saleId,
    ts: nowIso(),
    product_id: product.id,
    product_name: product.name,
    qty,
    unit_price: unitPrice,
    total_amount: total,
    customer_id: payload.customer_id ?? null,
    customer_name:
      payload.customer_id != null
        ? state.customers.find((c) => c.id === payload.customer_id)?.name ?? null
        : null,
    customer_phone:
      payload.customer_id != null
        ? state.customers.find((c) => c.id === payload.customer_id)?.phone ?? null
        : null,
    note: payload.note ?? null,
    is_credit: false,
    is_return: true,
    origin_sale_id: null,
  });
  const stockId = bumpId("stock");
  state.stock_movements.unshift({
    id: stockId,
    ts: nowIso(),
    kind: "RETURN",
    product_id: product.id,
    product_name: product.name,
    qty,
    unit_price: unitPrice,
    total_amount: total,
    counterparty: null,
    customer_id: payload.customer_id ?? null,
    customer_name:
      payload.customer_id != null
        ? state.customers.find((c) => c.id === payload.customer_id)?.name ?? null
        : null,
    note: payload.note ?? null,
    sale_id: saleId,
  });
  // Treat return as payment if it is associated to a customer
  if (payload.customer_id != null) {
    const customer = state.customers.find((c) => c.id === payload.customer_id)!;
    const creditId = bumpId("credit");
    state.credits.unshift({
      id: creditId,
      ts: nowIso(),
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      sale_id: saleId,
      amount: total,
      is_payment: true,
      note: payload.note ?? "반품 정산",
    });
  }
  saveState(state);
  return materialize(state);
}

async function local_record_credit_payment(payload: CreditPaymentPayload): Promise<AppData> {
  const state = loadState();
  const customer = state.customers.find((c) => c.id === payload.customer_id);
  if (!customer) return materialize(state);
  const creditId = bumpId("credit");
  state.credits.unshift({
    id: creditId,
    ts: nowIso(),
    customer_id: customer.id,
    customer_name: customer.name,
    customer_phone: customer.phone,
    sale_id: null,
    amount: payload.amount,
    is_payment: true,
    note: payload.note ?? null,
  });
  saveState(state);
  return materialize(state);
}

async function local_update_sale(payload: SaleUpdatePayload): Promise<AppData> {
  const state = loadState();
  const sale = state.sales.find((s) => s.id === payload.id);
  if (!sale) return materialize(state);
  if (sale.is_return) {
    throw new Error("반품 내역은 수정할 수 없습니다.");
  }
  const hasReturn = state.sales.some((s) => s.is_return && s.origin_sale_id === sale.id);
  if (hasReturn) {
    throw new Error("반품이 등록된 판매는 수정할 수 없습니다.");
  }
  const product = state.products.find((p) => p.id === sale.product_id);
  if (!product) return materialize(state);
  const qtyDelta = payload.qty - sale.qty;
  if (qtyDelta > 0 && product.qty < qtyDelta) {
    throw new Error("재고가 부족합니다.");
  }
  product.qty = product.qty - qtyDelta;
  sale.qty = payload.qty;
  sale.unit_price = payload.unit_price;
  sale.total_amount = payload.unit_price * payload.qty;
  sale.customer_id = payload.customer_id ?? null;
  sale.customer_name =
    payload.customer_id != null
      ? state.customers.find((c) => c.id === payload.customer_id)?.name ?? null
      : null;
  sale.customer_phone =
    payload.customer_id != null
      ? state.customers.find((c) => c.id === payload.customer_id)?.phone ?? null
      : null;
  sale.note = payload.note ?? null;
  sale.is_credit = !!payload.is_credit;
  const mv = state.stock_movements.find((m) => m.sale_id === sale.id && m.kind === "OUT");
  if (mv) {
    mv.qty = sale.qty;
    mv.unit_price = sale.unit_price;
    mv.total_amount = sale.total_amount;
    mv.customer_id = sale.customer_id;
    mv.customer_name = sale.customer_name;
    mv.note = sale.note;
  }
  const credit = state.credits.find((cr) => cr.sale_id === sale.id && !cr.is_payment);
  if (sale.is_credit) {
    if (credit) {
      credit.amount = sale.total_amount;
      credit.customer_id = sale.customer_id ?? credit.customer_id;
      credit.customer_name = sale.customer_name ?? credit.customer_name;
      credit.customer_phone = sale.customer_phone ?? credit.customer_phone;
    } else if (sale.customer_id != null) {
      const id = bumpId("credit");
      state.credits.unshift({
        id,
        ts: nowIso(),
        customer_id: sale.customer_id!,
        customer_name: sale.customer_name ?? "",
        customer_phone: sale.customer_phone ?? null,
        sale_id: sale.id,
        amount: sale.total_amount,
        is_payment: false,
        note: sale.note ?? null,
      });
    }
  } else {
    state.credits = state.credits.filter((cr) => !(cr.sale_id === sale.id && !cr.is_payment));
  }
  saveState(state);
  return materialize(state);
}

async function local_delete_sale(saleId: number): Promise<AppData> {
  const state = loadState();
  const sale = state.sales.find((s) => s.id === saleId);
  if (!sale) return materialize(state);
  if (sale.is_return) {
    throw new Error("반품 내역은 삭제할 수 없습니다.");
  }
  const hasReturn = state.sales.some((s) => s.is_return && s.origin_sale_id === sale.id);
  if (hasReturn) {
    throw new Error("반품이 등록된 판매는 삭제할 수 없습니다.");
  }
  const product = state.products.find((p) => p.id === sale.product_id);
  if (product) {
    product.qty = product.qty + sale.qty;
  }
  state.stock_movements = state.stock_movements.filter((m) => m.sale_id !== sale.id);
  state.credits = state.credits.filter((cr) => !(cr.sale_id === sale.id && !cr.is_payment));
  state.sales = state.sales.filter((s) => s.id !== sale.id);
  saveState(state);
  return materialize(state);
}

async function local_update_return(payload: ReturnUpdatePayload): Promise<AppData> {
  const state = loadState();
  const ret = state.sales.find((s) => s.id === payload.id && s.is_return);
  if (!ret) return materialize(state);
  const product = state.products.find((p) => p.id === ret.product_id);
  if (!product) return materialize(state);
  const prevTotal = ret.total_amount;
  const prevQty = ret.qty;
  const qtyDelta = payload.qty - prevQty;
  product.qty = product.qty + qtyDelta;
  const unit =
    payload.override_amount != null ? payload.override_amount / payload.qty : ret.unit_price;
  const total = unit * payload.qty;
  ret.qty = payload.qty;
  ret.unit_price = unit;
  ret.total_amount = total;
  ret.note = payload.note ?? ret.note;
  const mv = state.stock_movements.find((m) => m.sale_id === ret.id && m.kind === "RETURN");
  if (mv) {
    mv.qty = ret.qty;
    mv.unit_price = ret.unit_price;
    mv.total_amount = ret.total_amount;
    mv.note = ret.note;
  }
  const diff = total - prevTotal;
  if (ret.customer_id != null && diff !== 0) {
    const id = bumpId("credit");
    state.credits.unshift({
      id,
      ts: nowIso(),
      customer_id: ret.customer_id!,
      customer_name: ret.customer_name ?? "",
      customer_phone: ret.customer_phone ?? null,
      sale_id: ret.id,
      amount: Math.abs(diff),
      is_payment: diff > 0,
      note: "반품 수정 조정",
    });
  }
  saveState(state);
  return materialize(state);
}

async function local_delete_return(returnId: number): Promise<AppData> {
  const state = loadState();
  const ret = state.sales.find((s) => s.id === returnId && s.is_return);
  if (!ret) return materialize(state);
  const product = state.products.find((p) => p.id === ret.product_id);
  if (product) {
    product.qty = Math.max(product.qty - ret.qty, 0);
  }
  state.stock_movements = state.stock_movements.filter((m) => m.sale_id !== ret.id);
  if (ret.customer_id != null) {
    const id = bumpId("credit");
    state.credits.unshift({
      id,
      ts: nowIso(),
      customer_id: ret.customer_id!,
      customer_name: ret.customer_name ?? "",
      customer_phone: ret.customer_phone ?? null,
      sale_id: null,
      amount: ret.total_amount,
      is_payment: false,
      note: "반품 삭제 조정",
    });
  }
  state.sales = state.sales.filter((s) => s.id !== ret.id);
  saveState(state);
  return materialize(state);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return invoke<T>(cmd, args);
  }
  // Web mock
  switch (cmd) {
    case "get_app_data":
      return (await local_get_app_data()) as unknown as T;
    case "create_product":
      return (await local_create_product((args as any)?.payload)) as unknown as T;
    case "update_product":
      return (await local_update_product((args as any)?.payload)) as unknown as T;
    case "delete_product":
      return (await local_delete_product((args as any)?.productId)) as unknown as T;
    case "create_customer":
      return (await local_create_customer((args as any)?.payload)) as unknown as T;
    case "update_customer":
      return (await local_update_customer((args as any)?.payload)) as unknown as T;
    case "delete_customer":
      return (await local_delete_customer((args as any)?.customerId)) as unknown as T;
    case "record_stock_entry":
      return (await local_record_stock_entry((args as any)?.payload)) as unknown as T;
    case "record_sale":
      return (await local_record_sale((args as any)?.payload)) as unknown as T;
    case "record_return":
      return (await local_record_return((args as any)?.payload)) as unknown as T;
    case "record_credit_payment":
      return (await local_record_credit_payment((args as any)?.payload)) as unknown as T;
    case "update_sale":
      return (await local_update_sale((args as any)?.payload)) as unknown as T;
    case "delete_sale":
      return (await local_delete_sale((args as any)?.saleId)) as unknown as T;
    case "update_return":
      return (await (local_update_return as any)((args as any)?.payload)) as unknown as T;
    case "delete_return":
      return (await (local_delete_return as any)((args as any)?.returnId)) as unknown as T;
    default:
      throw new Error(`Unsupported command in web demo: ${cmd}`);
  }
}

export async function fetchAppData(): Promise<AppData> {
  return call<AppData>("get_app_data");
}

export async function createProduct(
  payload: ProductFormPayload,
): Promise<AppData> {
  return call<AppData>("create_product", { payload });
}

export async function updateProduct(
  payload: ProductUpdatePayload,
): Promise<AppData> {
  return call<AppData>("update_product", { payload });
}

export async function deleteProduct(productId: number): Promise<AppData> {
  return call<AppData>("delete_product", { productId });
}

export async function createCustomer(
  payload: CustomerFormPayload,
): Promise<AppData> {
  return call<AppData>("create_customer", { payload });
}

export async function updateCustomer(
  payload: CustomerUpdatePayload,
): Promise<AppData> {
  return call<AppData>("update_customer", { payload });
}

export async function deleteCustomer(customerId: number): Promise<AppData> {
  return call<AppData>("delete_customer", { customerId });
}

export async function recordStockEntry(
  payload: StockEntryPayload,
): Promise<AppData> {
  return call<AppData>("record_stock_entry", { payload });
}

export async function recordSale(payload: SalePayload): Promise<AppData> {
  return call<AppData>("record_sale", { payload });
}

export async function recordReturn(payload: ReturnPayload): Promise<AppData> {
  return call<AppData>("record_return", { payload });
}

export async function recordCreditPayment(
  payload: CreditPaymentPayload,
): Promise<AppData> {
  return call<AppData>("record_credit_payment", { payload });
}

export async function updateSale(payload: SaleUpdatePayload): Promise<AppData> {
  return call<AppData>("update_sale", { payload });
}

export async function deleteSale(saleId: number): Promise<AppData> {
  return call<AppData>("delete_sale", { saleId });
}

export async function updateReturn(payload: ReturnUpdatePayload): Promise<AppData> {
  return call<AppData>("update_return", { payload });
}

export async function deleteReturn(returnId: number): Promise<AppData> {
  return call<AppData>("delete_return", { returnId });
}
