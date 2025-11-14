export interface Product {
  id: number;
  name: string;
  sku: string | null;
  unit_price: number;
  qty: number;
  note: string | null;
  low_stock_threshold: number;
  created_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  created_at: string;
}

export type TransactionKind = "IN" | "OUT" | "RETURN";

export interface SaleRecord {
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
}

export interface StockMovement {
  id: number;
  ts: string;
  kind: TransactionKind;
  product_id: number;
  product_name: string;
  qty: number;
  unit_price: number | null;
  total_amount: number | null;
  counterparty: string | null;
  customer_id: number | null;
  customer_name: string | null;
  note: string | null;
  sale_id: number | null;
}

export interface CreditEntry {
  id: number;
  ts: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  sale_id: number | null;
  amount: number;
  is_payment: boolean;
  note: string | null;
}

export interface CustomerBalance {
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  total_credit: number;
  total_paid: number;
  outstanding: number;
  last_activity: string | null;
}

export interface AppData {
  products: Product[];
  customers: Customer[];
  sales: SaleRecord[];
  stock_movements: StockMovement[];
  credits: CreditEntry[];
  customer_balances: CustomerBalance[];
}

export interface ProductFormPayload {
  name: string;
  sku?: string | null;
  unit_price: number;
  note?: string | null;
  low_stock_threshold?: number | null;
  initial_qty?: number | null;
}

export interface ProductUpdatePayload {
  id: number;
  name: string;
  sku?: string | null;
  unit_price: number;
  note?: string | null;
  low_stock_threshold?: number | null;
}

export interface CustomerFormPayload {
  name: string;
  phone: string;
  note?: string | null;
}

export interface CustomerUpdatePayload {
  id: number;
  name: string;
  phone: string;
  note?: string | null;
}

export interface StockEntryPayload {
  product_id: number;
  qty: number;
  kind?: TransactionKind;
  unit_price?: number | null;
  counterparty?: string | null;
  customer_id?: number | null;
  note?: string | null;
}

export interface SalePayload {
  product_id: number;
  qty: number;
  unit_price?: number | null;
  customer_id?: number | null;
  note?: string | null;
  is_credit: boolean;
}

export interface SaleUpdatePayload {
  id: number;
  qty: number;
  unit_price: number;
  customer_id?: number | null;
  note?: string | null;
  is_credit: boolean;
}

export interface CreditPaymentPayload {
  customer_id: number;
  amount: number;
  note?: string | null;
}

export interface ReturnPayload {
  product_id: number;
  customer_id?: number | null;
  qty: number;
  note?: string | null;
  override_amount?: number | null;
}

export interface ReturnUpdatePayload {
  id: number; // return sale id
  qty: number;
  note?: string | null;
  override_amount?: number | null;
}
