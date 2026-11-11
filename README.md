# Нейрометр Web

Статический React + TypeScript viewer диагностических JSON v0.1.0. Канонические схемы и F01–F08: [`contracts/`](contracts/README.md). Реализация интерфейса B2: [`docs/B2_VIEWER.md`](docs/B2_VIEWER.md).

Клиентский импорт через browser File API, без загрузки диагностического файла в Интернет, без обязательного backend. GitHub Actions выполняет сборку, тесты и сохраняет статический `dist/` как артефакт для ревью. Production deployment не настроен.
