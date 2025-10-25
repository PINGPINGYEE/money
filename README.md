# Inventory Ledger Pro+

오프라인에서 재고·판매·외상 장부를 한 번에 관리할 수 있는 소상공인용 데스크톱 앱입니다.  
Tauri(Rust) + React + SQLite로 구성되어 인터넷 연결 없이도 동작하며, 기록은 로컬 데이터베이스(`inventory-ledger.db`)에 저장됩니다.

## 주요 기능

- **상품 관리**: 재고, 단가, 저재고 기준, 메모 관리 및 초기 재고 기록
- **고객 관리**: 전화번호(필수)와 메모 관리, 고객별 외상 잔액 확인
- **판매 등록**: 상품 선택, 단가 자동 입력, 외상 여부 지정, 재고 자동 차감
- **반품 관리**: 판매 건별 반품 등록으로 재고·장부·외상 잔액 자동 조정
- **입·출고 기록**: 입고/기타 출고 내역 관리, 거래처·단가·메모 저장
- **장부 조회**: 날짜/고객/상품 필터, 고객별 합계와 외상 금액 요약, CSV 내보내기
- **외상 관리**: 고객별 미수 현황, 결제 등록, 외상/결제 히스토리
- **보고서**: 재고 자산 가치, 월별 매출, 우수 고객, 저재고 알림 등 요약 정보 제공
- **CSV 내보내기**: 장부, 재고, 외상 데이터 각각 CSV로 추출 가능

## 기술 스택

- **프론트엔드**: React 18 + TypeScript + Vite
- **백엔드**: Rust (Tauri 2) + rusqlite(SQLite)
- **스타일링**: 커스텀 CSS

## 개발 환경 준비

사전에 아래 의존성을 설치합니다.

- Node.js ≥ 18
- Rust toolchain (`rustup` 및 `cargo`)
- Tauri 빌드 요구 사항  
  (macOS: Xcode Command Line Tools, Windows: Visual Studio Build Tools 등)

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 모드 실행 (웹 + Tauri)
npm run tauri dev
```

## 검증 및 빌드

```bash
# 프론트엔드 타입 검사 및 번들
npm run build

# Rust 백엔드 컴파일 확인
cargo check --manifest-path src-tauri/Cargo.toml

# Tauri 앱 패키징 (macOS .app / Windows .exe)
npm run tauri build
```

## 데이터 위치

최초 실행 시 앱 데이터 디렉터리에 `inventory-ledger.db`가 생성됩니다.  
(macOS: `~/Library/Application Support/inventory-ledger-pro-plus`)  
DB는 SQLite 포맷이므로 백업이나 마이그레이션이 간단합니다.

## CSV 내보내기

- **재고**: 상품 목록 패널 우측 상단 `CSV 내보내기`
- **장부**: 장부 탭 필터 하단 `CSV 내보내기`
- **외상**: 외상 탭 `CSV 내보내기`
- **입출고**: 입·출고 탭 `입출고 CSV 내보내기`

각 버튼은 현재 화면 데이터를 `.csv` 파일로 저장합니다.

## 개발 참고

- UI는 모든 탭에서 입력 → Tauri 명령 호출 → 최신 스냅샷으로 갱신되는 구조입니다.
- Rust 명령은 실패 시 사용자에게 명확한 오류 메시지를 전달하도록 `Result<T, String>` 형태로 구현했습니다.
- 데이터는 항상 새 스냅샷을 반환하므로 프론트엔드는 단순한 상태 업데이트만으로 최신 정보를 표시합니다.
