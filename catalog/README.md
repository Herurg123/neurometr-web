# B3.1 — Base Offline Catalog `2026.11.11.2`

**Статус: Draft PR; не объединён и не одобрен к поставке Agent.** Только каталожные метаданные. Ни загрузки весов, ни серверной публикации, ни приватных ключей, ни remote updates.

## Frozen artifacts

- `catalog/versions/2026.11.11.2/catalog.json`: immutable candidate schema `neurometr.catalog v0.1.0`; SHA-256 `1d84ff596c589a4db004f8a3fa17490d5479f57db3d7b0a433a7e448289651d2`; **6,589 UTF-8 bytes** по GitHub Actions [digest run](https://github.com/Herurg123/neurometr-web/actions/runs/43086237052).
- `catalog/manifests/2026.11.11.2/manifest.json`: **НЕПОДПИСАННЫЙ и НЕДОВЕРЕННЫЙ** draft с точным payload hash и bytes. Значение `signing_key_id=offline-unsigned-no-key` означает отсутствие ключа; поле `published_at` заполнено временем подготовки черновика и НЕ доказывает удалённую публикацию.
- `catalog/research/2026.11.11.2-evidence.json`: журнал проверенных HF источников. One-time [official metadata probe](https://github.com/Herurg123/neurometr-web/actions/runs/43085744751).
- `catalog/tests/test_b31_catalog.py`: независимые offline negative tests + canonical schema tests.

## Scope: only two real publisher-backed models

| model_id | quant | HF revision | Upstream GGUF bytes | Upstream GGUF SHA-256 |
|---|---|---|---:|---|
| `hf:Qwen/Qwen2.5-0.5B-Instruct` | Q4_K_M | `9217f5db79a29953eb74d5343926648285ec7e67` | 491400032 | `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` |
| `hf:Qwen/Qwen2.5-1.5B-Instruct` | Q4_K_M | `91cad51170dc346986eccefdc2dd33a9da36ead9` | 1117320736 | `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e` |

Источник: официальные репозитории [Qwen 0.5B GGUF](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF) и [Qwen 1.5B GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF), model cards, README, LICENSE и HF tree metadata с pin по full revision. Размер и SHA-256 GGUF получены из LFS metadata, **не** независимым чтением всех весов. Запрещено смешивать эти хеши с SHA-256 файла `catalog.json`.

Для подтверждённого контекста publisher сообщает 32,768 токенов и архитектуру `qwen2`. Это спецификация модели, не замер на пользовательском железе. Точные целочисленные `parameters` **не подтверждены** (публичные cards округляют 0.49B/1.54B): в snapshot `parameters=null`. Модальность text, формат GGUF, quant Q4_K_M и поля artifacts подкреплены полным `field_provenance` с `source_id`, `official_metadata`, временем проверки. Не выводить TPS, fit, runtime working, GPU/SYCL или что модель реально запускается из факта наличия файлов. `llmfit_overrides=[]`.

## License assessment

Оба pin-репозитория содержат модельные карточки с тегом **Apache-2.0** и файлы LICENSE (проверено ограниченными metadata+text-запросами в GitHub Actions). [0.5B LICENSE](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/9217f5db79a29953eb74d5343926648285ec7e67/LICENSE), [1.5B LICENSE](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/91cad51170dc346986eccefdc2dd33a9da36ead9/LICENSE). При последующей перепаковке/распространении весов требуется соблюсти лицензионные и notice-условия. **В этом PR веса НЕ распространяются**, только проверенные ссылки и метаданные. Лицензия не означает техническую совместимость с pinned llmfit.

## Integrity ≠ authenticity

`manifest.json` проходит JSON Schema Draft 2020-12, проверку размера и SHA-256 snapshot, но не имеет Ed25519 signature. Поэтому его **нельзя** рассматривать как доверенный удалённый manifest. Здесь нет `manifest.json.sig`, `latest.json`, publisher signing key, автоматического скачивания, сетевой активации или last-known-good workflow. Их реализация за пределами B3.1. В offline PoC сетевые обновления должны оставаться отключены.

## Agent pin-copy plan (только ПОСЛЕ отдельного разрешения)

После ревью/merge владелец Agent рабочего чата может скопировать точные байты `catalog.json` из утверждённого неизменяемого Web commit, зафиксировать `Web source commit`, `schema_version=0.1.0`, `catalog_version=2026.11.11.2`, `bytes=6589` и SHA-256 из этого README в pin-lock Agent. Agent должен повторно сверить размер/хеш/Schema/совместимость до использования bundled offline catalog. Нельзя переносить доверие от неподписанного manifest; никаких изменений Agent в данном PR.

## CI and remaining limitations

Обычный [B3.1 Offline Catalog Snapshot CI](../../.github/workflows/catalog-b31-ci.yml) не делает запросов к сети, кроме стандартной установки pinned validator в Github runner. Он повторяет 44 baseline contract tests и negative tests каталога: corrupt JSON/payload, неправильные SHA/size/version/path, отсутствующий provenance, недостоверный source reference, schema+diagnostic compatibility, отсутствие PII/секретов. Probe переподключён только к `workflow_dispatch` (без schedule и без автоматического refresh).

**Не проверялось:** скачивание и локальное хеширование GGUF-весов, реальные запуски моделей, llmfit mapping или override PoC, реальная интеграция с Agent, криптографическая подпись, обновления удалённого каталога, production deployment.
