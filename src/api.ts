import { invoke } from "@tauri-apps/api/core";
import type {
  AppData,
  CreditPaymentPayload,
  CustomerFormPayload,
  CustomerUpdatePayload,
  ProductFormPayload,
  ProductUpdatePayload,
  SalePayload,
  ReturnPayload,
  StockEntryPayload,
} from "./types";

export async function fetchAppData(): Promise<AppData> {
  return invoke<AppData>("get_app_data");
}

export async function createProduct(
  payload: ProductFormPayload,
): Promise<AppData> {
  return invoke<AppData>("create_product", { payload });
}

export async function updateProduct(
  payload: ProductUpdatePayload,
): Promise<AppData> {
  return invoke<AppData>("update_product", { payload });
}

export async function deleteProduct(productId: number): Promise<AppData> {
  return invoke<AppData>("delete_product", { productId });
}

export async function createCustomer(
  payload: CustomerFormPayload,
): Promise<AppData> {
  return invoke<AppData>("create_customer", { payload });
}

export async function updateCustomer(
  payload: CustomerUpdatePayload,
): Promise<AppData> {
  return invoke<AppData>("update_customer", { payload });
}

export async function deleteCustomer(customerId: number): Promise<AppData> {
  return invoke<AppData>("delete_customer", { customerId });
}

export async function recordStockEntry(
  payload: StockEntryPayload,
): Promise<AppData> {
  return invoke<AppData>("record_stock_entry", { payload });
}

export async function recordSale(payload: SalePayload): Promise<AppData> {
  return invoke<AppData>("record_sale", { payload });
}

export async function recordReturn(payload: ReturnPayload): Promise<AppData> {
  return invoke<AppData>("record_return", { payload });
}

export async function recordCreditPayment(
  payload: CreditPaymentPayload,
): Promise<AppData> {
  return invoke<AppData>("record_credit_payment", { payload });
}
