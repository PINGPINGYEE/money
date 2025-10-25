use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, State};
use thiserror::Error;

type CommandResult<T> = Result<T, String>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            let state = DbState::initialize(&handle)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_data,
            create_product,
            update_product,
            delete_product,
            create_customer,
            update_customer,
            delete_customer,
            record_stock_entry,
            record_sale,
            record_return,
            record_credit_payment,
            save_csv
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug, Error)]
enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("config error: {0}")]
    Config(String),
    #[error("validation error: {0}")]
    Validation(String),
}

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_string()
    }
}

struct DbState {
    path: PathBuf,
}

impl DbState {
    fn initialize(app: &tauri::AppHandle) -> Result<Self, AppError> {
        let data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| AppError::Config(format!("failed to resolve app data directory: {e}")))?;
        fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("inventory-ledger.db");

        let mut conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        Self::run_migrations(&mut conn)?;

        Ok(Self { path: db_path })
    }

    fn open(&self) -> Result<Connection, AppError> {
        let conn = Connection::open(&self.path)?;
        conn.execute("PRAGMA foreign_keys = ON;", [])?;
        Ok(conn)
    }

    fn run_migrations(conn: &mut Connection) -> Result<(), AppError> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sku TEXT,
                unit_price REAL NOT NULL DEFAULT 0,
                qty REAL NOT NULL DEFAULT 0,
                note TEXT,
                low_stock_threshold REAL NOT NULL DEFAULT 5,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                product_id INTEGER NOT NULL,
                qty REAL NOT NULL,
                price_snapshot REAL NOT NULL,
                total_amount REAL NOT NULL,
                customer_id INTEGER,
                note TEXT,
                is_credit INTEGER NOT NULL DEFAULT 0,
                is_return INTEGER NOT NULL DEFAULT 0,
                origin_sale_id INTEGER,
                FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT,
                FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL,
                FOREIGN KEY(origin_sale_id) REFERENCES sales(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                kind TEXT NOT NULL,
                product_id INTEGER NOT NULL,
                qty REAL NOT NULL,
                unit_price REAL,
                total_amount REAL,
                counterparty TEXT,
                customer_id INTEGER,
                note TEXT,
                sale_id INTEGER,
                FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE RESTRICT,
                FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL,
                FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS credits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                customer_id INTEGER NOT NULL,
                sale_id INTEGER,
                amount REAL NOT NULL,
                is_payment INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
            CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
            CREATE INDEX IF NOT EXISTS idx_sales_ts ON sales(ts);
            CREATE INDEX IF NOT EXISTS idx_transactions_ts ON transactions(ts);
            CREATE INDEX IF NOT EXISTS idx_credits_customer ON credits(customer_id);
            ",
        )?;
        // add archived column for soft-deleting products
        ensure_column(
            conn,
            "products",
            "archived",
            "ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            conn,
            "sales",
            "is_return",
            "ALTER TABLE sales ADD COLUMN is_return INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(
            conn,
            "sales",
            "origin_sale_id",
            "ALTER TABLE sales ADD COLUMN origin_sale_id INTEGER",
        )?;
        ensure_column(
            conn,
            "sales",
            "customer_deleted",
            "ALTER TABLE sales ADD COLUMN customer_deleted INTEGER NOT NULL DEFAULT 0",
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sales_origin ON sales(origin_sale_id);",
            [],
        )?;
        Ok(())
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn map_app_err(err: AppError) -> String {
    err.into()
}

fn map_sql_err(err: rusqlite::Error) -> String {
    AppError::from(err).into()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum TransactionKind {
    In,
    Out,
    Return,
}

impl TransactionKind {
    fn as_str(&self) -> &'static str {
        match self {
            TransactionKind::In => "IN",
            TransactionKind::Out => "OUT",
            TransactionKind::Return => "RETURN",
        }
    }

    fn from_db(value: &str) -> Option<Self> {
        match value {
            "IN" => Some(TransactionKind::In),
            "OUT" => Some(TransactionKind::Out),
            "RETURN" => Some(TransactionKind::Return),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize)]
struct Product {
    id: i64,
    name: String,
    sku: Option<String>,
    unit_price: f64,
    qty: f64,
    note: Option<String>,
    low_stock_threshold: f64,
    created_at: String,
}

#[derive(Debug, Serialize)]
struct Customer {
    id: i64,
    name: String,
    phone: Option<String>,
    note: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize)]
struct SaleRecord {
    id: i64,
    ts: String,
    product_id: i64,
    product_name: String,
    qty: f64,
    unit_price: f64,
    total_amount: f64,
    customer_id: Option<i64>,
    customer_name: Option<String>,
    customer_phone: Option<String>,
    note: Option<String>,
    is_credit: bool,
    is_return: bool,
    origin_sale_id: Option<i64>,
    customer_deleted: bool,
}

#[derive(Debug, Serialize)]
struct StockMovement {
    id: i64,
    ts: String,
    kind: TransactionKind,
    product_id: i64,
    product_name: String,
    qty: f64,
    unit_price: Option<f64>,
    total_amount: Option<f64>,
    counterparty: Option<String>,
    customer_id: Option<i64>,
    customer_name: Option<String>,
    note: Option<String>,
    sale_id: Option<i64>,
}

#[derive(Debug, Serialize)]
struct CreditEntry {
    id: i64,
    ts: String,
    customer_id: i64,
    customer_name: String,
    customer_phone: Option<String>,
    sale_id: Option<i64>,
    amount: f64,
    is_payment: bool,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
struct CustomerBalance {
    customer_id: i64,
    customer_name: String,
    customer_phone: Option<String>,
    total_credit: f64,
    total_paid: f64,
    outstanding: f64,
    last_activity: Option<String>,
}

#[derive(Debug, Serialize)]
struct AppData {
    products: Vec<Product>,
    customers: Vec<Customer>,
    sales: Vec<SaleRecord>,
    stock_movements: Vec<StockMovement>,
    credits: Vec<CreditEntry>,
    customer_balances: Vec<CustomerBalance>,
}

#[tauri::command]
fn get_app_data(state: State<DbState>) -> CommandResult<AppData> {
    load_app_data(&state).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct ProductForm {
    name: String,
    sku: Option<String>,
    unit_price: f64,
    note: Option<String>,
    low_stock_threshold: Option<f64>,
    initial_qty: Option<f64>,
}

#[tauri::command]
fn create_product(state: State<DbState>, payload: ProductForm) -> CommandResult<AppData> {
    if payload.name.trim().is_empty() {
        return Err(AppError::Validation("상품 이름을 입력해주세요.".into()).into());
    }
    if payload.unit_price < 0.0 {
        return Err(AppError::Validation("단가는 0 이상이어야 합니다.".into()).into());
    }
    if let Some(qty) = payload.initial_qty {
        if qty < 0.0 {
            return Err(AppError::Validation("초기 재고는 0 이상이어야 합니다.".into()).into());
        }
    }

    let mut conn = state.open().map_err(map_app_err)?;
    let tx = conn.transaction().map_err(map_sql_err)?;

    tx.execute(
        "INSERT INTO products (name, sku, unit_price, qty, note, low_stock_threshold) VALUES (?, ?, ?, 0, ?, ?)",
        params![
            payload.name.trim(),
            payload.sku.as_deref(),
            payload.unit_price,
            payload.note.as_deref(),
            payload.low_stock_threshold.unwrap_or(5.0)
        ],
    )
    .map_err(map_sql_err)?;

    let product_id = tx.last_insert_rowid();
    if let Some(initial_qty) = payload.initial_qty {
        if initial_qty > 0.0 {
            let ts = now_iso();
            tx.execute(
                "UPDATE products SET qty = qty + ? WHERE id = ?",
                params![initial_qty, product_id],
            )
            .map_err(map_sql_err)?;
            tx.execute(
                "INSERT INTO transactions (ts, kind, product_id, qty, unit_price, total_amount, note) VALUES (?, 'IN', ?, ?, ?, ?, ?)",
                params![
                    ts,
                    product_id,
                    initial_qty,
                    payload.unit_price,
                    Some(initial_qty * payload.unit_price),
                    Some("초기 재고 입력".to_string())
                ],
            )
            .map_err(map_sql_err)?;
        }
    }

    tx.commit().map_err(map_sql_err)?;
    load_app_data(&state).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct ProductUpdateForm {
    id: i64,
    name: String,
    sku: Option<String>,
    unit_price: f64,
    note: Option<String>,
    low_stock_threshold: Option<f64>,
}

#[tauri::command]
fn update_product(state: State<DbState>, payload: ProductUpdateForm) -> CommandResult<AppData> {
    if payload.name.trim().is_empty() {
        return Err(AppError::Validation("상품 이름을 입력해주세요.".into()).into());
    }
    if payload.unit_price < 0.0 {
        return Err(AppError::Validation("단가는 0 이상이어야 합니다.".into()).into());
    }

    let conn = state.open().map_err(map_app_err)?;
    conn.execute(
        "UPDATE products SET name = ?, sku = ?, unit_price = ?, note = ?, low_stock_threshold = ? WHERE id = ?",
        params![
            payload.name.trim(),
            payload.sku.as_deref(),
            payload.unit_price,
            payload.note.as_deref(),
            payload.low_stock_threshold.unwrap_or(5.0),
            payload.id
        ],
    )
    .map_err(map_sql_err)?;

    load_app_data(&state).map_err(Into::into)
}

#[tauri::command]
fn delete_product(state: State<DbState>, product_id: i64) -> CommandResult<AppData> {
    let conn = state.open().map_err(map_app_err)?;
    // Soft delete: archive the product so history remains intact
    conn.execute(
        "UPDATE products SET archived = 1 WHERE id = ?",
        params![product_id],
    )
    .map_err(map_sql_err)?;
    load_app_data(&state).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct CustomerForm {
    name: String,
    phone: String,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CustomerUpdateForm {
    id: i64,
    name: String,
    phone: String,
    note: Option<String>,
}

#[tauri::command]
fn create_customer(state: State<DbState>, payload: CustomerForm) -> CommandResult<AppData> {
    if payload.name.trim().is_empty() {
        return Err(AppError::Validation("고객 이름을 입력해주세요.".into()).into());
    }
    let phone = payload.phone.trim();
    if phone.is_empty() {
        return Err(AppError::Validation("고객 연락처를 입력해주세요.".into()).into());
    }
    let conn = state.open().map_err(map_app_err)?;
    conn.execute(
        "INSERT INTO customers (name, phone, note) VALUES (?, ?, ?)",
        params![payload.name.trim(), phone, payload.note.as_deref()],
    )
    .map_err(map_sql_err)?;

    load_app_data(&state).map_err(Into::into)
}

#[tauri::command]
fn update_customer(state: State<DbState>, payload: CustomerUpdateForm) -> CommandResult<AppData> {
    if payload.name.trim().is_empty() {
        return Err(AppError::Validation("고객 이름을 입력해주세요.".into()).into());
    }
    let phone = payload.phone.trim();
    if phone.is_empty() {
        return Err(AppError::Validation("고객 연락처를 입력해주세요.".into()).into());
    }
    let conn = state.open().map_err(map_app_err)?;
    conn.execute(
        "UPDATE customers SET name = ?, phone = ?, note = ? WHERE id = ?",
        params![
            payload.name.trim(),
            phone,
            payload.note.as_deref(),
            payload.id
        ],
    )
    .map_err(map_sql_err)?;

    load_app_data(&state).map_err(Into::into)
}

#[tauri::command]
fn delete_customer(state: State<DbState>, customer_id: i64) -> CommandResult<AppData> {
    let conn = state.open().map_err(map_app_err)?;
    // mark related sales as deleted-customer before FK nullify kicks in
    conn.execute(
        "UPDATE sales SET customer_deleted = 1 WHERE customer_id = ?",
        params![customer_id],
    )
    .map_err(map_sql_err)?;
    conn.execute("DELETE FROM customers WHERE id = ?", params![customer_id])
        .map_err(|err| match err {
            rusqlite::Error::SqliteFailure(_, _) => {
                AppError::Validation("해당 고객은 거래 내역이 있어 삭제할 수 없습니다.".into())
                    .to_string()
            }
            other => other.to_string(),
        })?;

    load_app_data(&state).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct StockEntryPayload {
    product_id: i64,
    qty: f64,
    kind: Option<TransactionKind>,
    unit_price: Option<f64>,
    counterparty: Option<String>,
    customer_id: Option<i64>,
    note: Option<String>,
}

#[tauri::command]
fn record_stock_entry(state: State<DbState>, payload: StockEntryPayload) -> CommandResult<AppData> {
    if payload.qty <= 0.0 {
        return Err(AppError::Validation("미터은 0보다 커야 합니다.".into()).into());
    }
    let kind = payload.kind.unwrap_or(TransactionKind::In);

    let mut conn = state.open().map_err(map_app_err)?;
    let tx = conn.transaction().map_err(map_sql_err)?;

    let product = tx
        .query_row(
            "SELECT qty, unit_price FROM products WHERE id = ?",
            params![payload.product_id],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
        )
        .optional()
        .map_err(map_sql_err)?;

    let (current_qty, default_price) = product
        .ok_or_else(|| AppError::Validation("존재하지 않는 상품입니다.".into()).to_string())?;

    let qty_delta = match kind {
        TransactionKind::In => payload.qty,
        TransactionKind::Out => -payload.qty,
        TransactionKind::Return => {
            return Err(
                AppError::Validation("반품 입력은 반품 등록 기능을 사용해주세요.".into()).into(),
            );
        }
    };
    let new_qty = current_qty + qty_delta;
    if new_qty < 0.0 {
        return Err(AppError::Validation("재고가 부족합니다.".into()).into());
    }
    tx.execute(
        "UPDATE products SET qty = qty + ? WHERE id = ?",
        params![qty_delta, payload.product_id],
    )
    .map_err(map_sql_err)?;

    let ts = now_iso();
    let unit_price = payload.unit_price.or(Some(default_price));
    let total_amount = unit_price.map(|price| price * payload.qty);

    tx.execute(
        "INSERT INTO transactions (ts, kind, product_id, qty, unit_price, total_amount, counterparty, customer_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            ts,
            kind.as_str(),
            payload.product_id,
            payload.qty,
            unit_price,
            total_amount,
            payload.counterparty.as_deref(),
            payload.customer_id,
            payload.note.as_deref()
        ],
    )
    .map_err(map_sql_err)?;

    tx.commit().map_err(map_sql_err)?;
    load_app_data(&state).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
struct SalePayload {
    product_id: i64,
    qty: f64,
    unit_price: Option<f64>,
    customer_id: Option<i64>,
    note: Option<String>,
    is_credit: bool,
}

#[derive(Debug, Deserialize)]
struct ReturnPayload {
    product_id: i64,
    customer_id: Option<i64>,
    qty: f64,
    note: Option<String>,
    override_amount: Option<f64>,
}

#[tauri::command]
fn record_sale(state: State<DbState>, payload: SalePayload) -> CommandResult<AppData> {
    if payload.qty <= 0.0 {
        return Err(AppError::Validation("미터은 0보다 커야 합니다.".into()).into());
    }
    if payload.is_credit && payload.customer_id.is_none() {
        return Err(AppError::Validation("외상 거래에는 고객을 선택해야 합니다.".into()).into());
    }

    let mut conn = state.open().map_err(map_app_err)?;
    let tx = conn.transaction().map_err(map_sql_err)?;

    let product = tx
        .query_row(
            "SELECT qty, unit_price FROM products WHERE id = ?",
            params![payload.product_id],
            |row| Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?)),
        )
        .optional()
        .map_err(map_sql_err)?;
    let (current_qty, default_price) = product
        .ok_or_else(|| AppError::Validation("존재하지 않는 상품입니다.".into()).to_string())?;

    if current_qty < payload.qty {
        return Err(AppError::Validation("재고가 부족합니다.".into()).into());
    }

    let unit_price = payload.unit_price.unwrap_or(default_price);
    let total_amount = unit_price * payload.qty;
    let ts = now_iso();

    tx.execute(
        "UPDATE products SET qty = qty - ? WHERE id = ?",
        params![payload.qty, payload.product_id],
    )
    .map_err(map_sql_err)?;

    tx.execute(
        "INSERT INTO sales (ts, product_id, qty, price_snapshot, total_amount, customer_id, note, is_credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            ts,
            payload.product_id,
            payload.qty,
            unit_price,
            total_amount,
            payload.customer_id,
            payload.note.as_deref(),
            if payload.is_credit { 1 } else { 0 }
        ],
    )
    .map_err(map_sql_err)?;

    let sale_id = tx.last_insert_rowid();

    tx.execute(
        "INSERT INTO transactions (ts, kind, product_id, qty, unit_price, total_amount, customer_id, note, sale_id) VALUES (?, 'OUT', ?, ?, ?, ?, ?, ?, ?)",
        params![
            ts,
            payload.product_id,
            payload.qty,
            unit_price,
            total_amount,
            payload.customer_id,
            payload.note.as_deref(),
            sale_id
        ],
    )
    .map_err(map_sql_err)?;

    if payload.is_credit {
        tx.execute(
            "INSERT INTO credits (ts, customer_id, sale_id, amount, is_payment, note) VALUES (?, ?, ?, ?, 0, ?)",
            params![
                ts,
                payload.customer_id,
                sale_id,
                total_amount,
                payload.note.as_deref()
            ],
        )
        .map_err(map_sql_err)?;
    }

    tx.commit().map_err(map_sql_err)?;
    load_app_data(&state).map_err(Into::into)
}

#[tauri::command]
fn record_return(state: State<DbState>, payload: ReturnPayload) -> CommandResult<AppData> {
    if payload.qty <= 0.0 {
        return Err(AppError::Validation("반품 수량은 0보다 커야 합니다.".into()).into());
    }

    let mut conn = state.open().map_err(map_app_err)?;
    let tx = conn.transaction().map_err(map_sql_err)?;

    let sql = "
        SELECT
            s.id,
            s.qty,
            s.price_snapshot,
            s.is_credit,
            s.customer_id,
            IFNULL(SUM(r.qty), 0) AS returned
        FROM sales s
        LEFT JOIN sales r ON r.origin_sale_id = s.id AND r.is_return = 1
        WHERE s.product_id = ?1
          AND (
                (?2 IS NULL AND s.customer_id IS NULL) OR
                (?2 IS NOT NULL AND s.customer_id = ?2)
              )
          AND s.is_return = 0
        GROUP BY s.id, s.qty, s.price_snapshot, s.is_credit, s.customer_id
        HAVING s.qty - IFNULL(SUM(r.qty), 0) > 0
        ORDER BY s.ts ASC
    ";

    let mut stmt = tx.prepare(sql).map_err(map_sql_err)?;
    let mut rows = stmt
        .query(params![payload.product_id, payload.customer_id])
        .map_err(map_sql_err)?;

    struct OutstandingSale {
        sale_id: i64,
        price_snapshot: f64,
        customer_id: Option<i64>,
        was_credit: bool,
        available: f64,
    }

    let mut outstanding_sales: Vec<OutstandingSale> = Vec::new();
    let mut total_available = 0.0;

    while let Some(row) = rows.next().map_err(map_sql_err)? {
        let sale_id: i64 = row.get(0).map_err(map_sql_err)?;
        let sale_qty: f64 = row.get(1).map_err(map_sql_err)?;
        let price_snapshot: f64 = row.get(2).map_err(map_sql_err)?;
        let was_credit = row
            .get::<_, i64>(3)
            .map_err(map_sql_err)?
            != 0;
        let customer_id = row
            .get::<_, Option<i64>>(4)
            .map_err(map_sql_err)?;
        let returned: f64 = row.get(5).map_err(map_sql_err)?;
        let available = sale_qty - returned;
        if available > 0.0 {
            total_available += available;
            outstanding_sales.push(OutstandingSale {
                sale_id,
                price_snapshot,
                customer_id,
                was_credit,
                available,
            });
        }
    }
    drop(rows);
    drop(stmt);

    if outstanding_sales.is_empty() {
        return Err(AppError::Validation("반품 가능한 판매 내역이 없습니다.".into()).into());
    }

    if total_available + f64::EPSILON < payload.qty {
        return Err(AppError::Validation("반품 수량이 남은 수량을 초과했습니다.".into()).into());
    }

    let ts = now_iso();

    tx.execute(
        "UPDATE products SET qty = qty + ? WHERE id = ?",
        params![payload.qty, payload.product_id],
    )
    .map_err(map_sql_err)?;

    let mut remaining_qty = payload.qty;
    let mut computed_total = 0.0;
    for entry in outstanding_sales {
        if remaining_qty <= 0.0 {
            break;
        }
        let portion = remaining_qty.min(entry.available);
        insert_return_for_sale(
            &tx,
            &ts,
            payload.product_id,
            portion,
            entry.price_snapshot,
            entry.customer_id,
            entry.was_credit,
            entry.sale_id,
            payload.note.as_deref(),
        )
        .map_err(map_app_err)?;
        computed_total += portion * entry.price_snapshot;
        remaining_qty -= portion;
    }

    // If an override amount is provided and differs from computed_total, add an adjustment credit/payment
    if let Some(override_amount) = payload.override_amount {
        let diff = override_amount - computed_total;
        if diff.abs() > f64::EPSILON {
            if let Some(cid) = payload.customer_id {
                tx.execute(
                    "INSERT INTO credits (ts, customer_id, sale_id, amount, is_payment, note) VALUES (?, ?, NULL, ?, ?, ?)",
                    params![
                        ts,
                        cid,
                        diff.abs(),
                        if diff > 0.0 { 0 } else { 1 },
                        Some("반품 금액 조정")
                    ],
                )
                .map_err(map_sql_err)?;
            }
        }
    }

    tx.commit().map_err(map_sql_err)?;
    load_app_data(&state).map_err(Into::into)
}

fn insert_return_for_sale(
    tx: &rusqlite::Transaction<'_>,
    ts: &str,
    product_id: i64,
    qty: f64,
    price_snapshot: f64,
    customer_id: Option<i64>,
    was_credit: bool,
    origin_sale_id: i64,
    note: Option<&str>,
) -> Result<(), AppError> {
    let total_amount = price_snapshot * qty;

    tx.execute(
        "INSERT INTO sales (ts, product_id, qty, price_snapshot, total_amount, customer_id, note, is_credit, is_return, origin_sale_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        params![
            ts,
            product_id,
            qty,
            price_snapshot,
            total_amount,
            customer_id,
            note,
            if was_credit { 1 } else { 0 },
            origin_sale_id
        ],
    )?;

    let return_sale_id = tx.last_insert_rowid();

    tx.execute(
        "INSERT INTO transactions (ts, kind, product_id, qty, unit_price, total_amount, customer_id, note, sale_id)
         VALUES (?, 'RETURN', ?, ?, ?, ?, ?, ?, ?)",
        params![
            ts,
            product_id,
            qty,
            price_snapshot,
            total_amount,
            customer_id,
            note,
            return_sale_id
        ],
    )?;

    if was_credit {
        if let Some(cid) = customer_id {
            let credit_note = note.unwrap_or("반품 정산");
            tx.execute(
                "INSERT INTO credits (ts, customer_id, sale_id, amount, is_payment, note)
                 VALUES (?, ?, ?, ?, 1, ?)",
                params![ts, cid, origin_sale_id, total_amount, credit_note],
            )?;
        }
    }

    Ok(())
}


#[derive(Debug, Deserialize)]
struct CreditPaymentPayload {
    customer_id: i64,
    amount: f64,
    note: Option<String>,
}

#[tauri::command]
fn record_credit_payment(
    state: State<DbState>,
    payload: CreditPaymentPayload,
) -> CommandResult<AppData> {
    if payload.amount <= 0.0 {
        return Err(AppError::Validation("결제 금액은 0보다 커야 합니다.".into()).into());
    }

    let conn = state.open().map_err(map_app_err)?;

    let exists = conn
        .query_row(
            "SELECT 1 FROM customers WHERE id = ?",
            params![payload.customer_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(map_sql_err)?;

    if exists.is_none() {
        return Err(AppError::Validation("존재하지 않는 고객입니다.".into()).into());
    }

    conn.execute(
        "INSERT INTO credits (ts, customer_id, sale_id, amount, is_payment, note) VALUES (?, ?, NULL, ?, 1, ?)",
        params![
            now_iso(),
            payload.customer_id,
            payload.amount,
            payload.note.as_deref()
        ],
    )
    .map_err(map_sql_err)?;

    load_app_data(&state).map_err(Into::into)
}

fn load_app_data(state: &DbState) -> Result<AppData, AppError> {
    let conn = state.open()?;
    build_app_data(&conn)
}

fn build_app_data(conn: &Connection) -> Result<AppData, AppError> {
    let products = fetch_products(conn)?;
    let customers = fetch_customers(conn)?;
    let sales = fetch_sales(conn)?;
    let stock_movements = fetch_transactions(conn)?;
    let credits = fetch_credits(conn)?;
    let customer_balances = fetch_customer_balances(conn)?;

    Ok(AppData {
        products,
        customers,
        sales,
        stock_movements,
        credits,
        customer_balances,
    })
}

fn ensure_column(
    conn: &mut Connection,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), AppError> {
    let pragma = format!("PRAGMA table_info({})", table);
    let mut stmt = conn.prepare(&pragma)?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(());
        }
    }
    conn.execute(alter_sql, [])?;
    Ok(())
}

fn fetch_products(conn: &Connection) -> Result<Vec<Product>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, sku, unit_price, qty, note, low_stock_threshold, created_at
         FROM products
         WHERE archived = 0
         ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Product {
            id: row.get(0)?,
            name: row.get(1)?,
            sku: row.get(2)?,
            unit_price: row.get(3)?,
            qty: row.get(4)?,
            note: row.get(5)?,
            low_stock_threshold: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;

    let mut products = Vec::new();
    for row in rows {
        products.push(row?);
    }
    Ok(products)
}

fn fetch_customers(conn: &Connection) -> Result<Vec<Customer>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, phone, note, created_at
         FROM customers
         ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Customer {
            id: row.get(0)?,
            name: row.get(1)?,
            phone: row.get(2)?,
            note: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    let mut customers = Vec::new();
    for row in rows {
        customers.push(row?);
    }
    Ok(customers)
}

fn fetch_sales(conn: &Connection) -> Result<Vec<SaleRecord>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT
            s.id,
            s.ts,
            s.product_id,
            p.name,
            s.qty,
            s.price_snapshot,
            s.total_amount,
            s.customer_id,
            c.name,
            c.phone,
            s.note,
            s.is_credit,
            s.is_return,
            s.origin_sale_id,
            s.customer_deleted
        FROM sales s
        JOIN products p ON p.id = s.product_id
        LEFT JOIN customers c ON c.id = s.customer_id
        ORDER BY s.ts DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(SaleRecord {
            id: row.get(0)?,
            ts: row.get(1)?,
            product_id: row.get(2)?,
            product_name: row.get(3)?,
            qty: row.get(4)?,
            unit_price: row.get(5)?,
            total_amount: row.get(6)?,
            customer_id: row.get(7)?,
            customer_name: row.get(8)?,
            customer_phone: row.get(9)?,
            note: row.get(10)?,
            is_credit: row.get::<_, i64>(11)? != 0,
            is_return: row.get::<_, i64>(12)? != 0,
            origin_sale_id: row.get(13)?,
            customer_deleted: row.get::<_, i64>(14)? != 0,
        })
    })?;

    let mut sales = Vec::new();
    for row in rows {
        sales.push(row?);
    }
    Ok(sales)
}

fn fetch_transactions(conn: &Connection) -> Result<Vec<StockMovement>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT
            t.id,
            t.ts,
            t.kind,
            t.product_id,
            p.name,
            t.qty,
            t.unit_price,
            t.total_amount,
            t.counterparty,
            t.customer_id,
            c.name,
            t.note,
            t.sale_id
        FROM transactions t
        JOIN products p ON p.id = t.product_id
        LEFT JOIN customers c ON c.id = t.customer_id
        ORDER BY t.ts DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        let kind_str: String = row.get(2)?;
        let kind = TransactionKind::from_db(&kind_str).unwrap_or(TransactionKind::In);
        Ok(StockMovement {
            id: row.get(0)?,
            ts: row.get(1)?,
            kind,
            product_id: row.get(3)?,
            product_name: row.get(4)?,
            qty: row.get(5)?,
            unit_price: row.get(6)?,
            total_amount: row.get(7)?,
            counterparty: row.get(8)?,
            customer_id: row.get(9)?,
            customer_name: row.get(10)?,
            note: row.get(11)?,
            sale_id: row.get(12)?,
        })
    })?;

    let mut transactions = Vec::new();
    for row in rows {
        transactions.push(row?);
    }
    Ok(transactions)
}

fn fetch_credits(conn: &Connection) -> Result<Vec<CreditEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT
            cr.id,
            cr.ts,
            cr.customer_id,
            c.name,
            c.phone,
            cr.sale_id,
            cr.amount,
            cr.is_payment,
            cr.note
        FROM credits cr
        JOIN customers c ON c.id = cr.customer_id
        ORDER BY cr.ts DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(CreditEntry {
            id: row.get(0)?,
            ts: row.get(1)?,
            customer_id: row.get(2)?,
            customer_name: row.get(3)?,
            customer_phone: row.get(4)?,
            sale_id: row.get(5)?,
            amount: row.get(6)?,
            is_payment: row.get::<_, i64>(7)? != 0,
            note: row.get(8)?,
        })
    })?;

    let mut credits = Vec::new();
    for row in rows {
        credits.push(row?);
    }
    Ok(credits)
}

fn fetch_customer_balances(conn: &Connection) -> Result<Vec<CustomerBalance>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT
            c.id,
            c.name,
            c.phone,
            IFNULL(SUM(CASE WHEN cr.is_payment = 0 THEN cr.amount ELSE 0 END), 0) AS total_credit,
            IFNULL(SUM(CASE WHEN cr.is_payment = 1 THEN cr.amount ELSE 0 END), 0) AS total_paid,
            MAX(cr.ts)
        FROM customers c
        LEFT JOIN credits cr ON cr.customer_id = c.id
        GROUP BY c.id, c.name
        ORDER BY c.name COLLATE NOCASE",
    )?;

    let rows = stmt.query_map([], |row| {
        let total_credit: f64 = row.get(3)?;
        let total_paid: f64 = row.get(4)?;
        Ok(CustomerBalance {
            customer_id: row.get(0)?,
            customer_name: row.get(1)?,
            customer_phone: row.get(2)?,
            total_credit,
            total_paid,
            outstanding: total_credit - total_paid,
            last_activity: row.get(5)?,
        })
    })?;

    let mut balances = Vec::new();
    for row in rows {
        balances.push(row?);
    }
    Ok(balances)
}

#[tauri::command]
fn save_csv(app: tauri::AppHandle, filename: String, content: String) -> CommandResult<String> {
    // Resolve Desktop directory; fallback to app local data dir if unavailable
    let desktop_dir = app
        .path()
        .desktop_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve desktop dir: {e}")))
        .ok();

    let mut target: PathBuf = if let Some(dir) = desktop_dir {
        dir
    } else {
        app
            .path()
            .app_local_data_dir()
            .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))
            .map_err(Into::<String>::into)?
    };

    // Ensure .csv extension
    let fname = if filename.to_lowercase().ends_with(".csv") {
        filename
    } else {
        format!("{}.csv", filename)
    };

    target.push(fname);

    fs::write(&target, content).map_err(|e| AppError::Io(e).to_string())?;

    Ok(target
        .to_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| String::from("saved")))
}
