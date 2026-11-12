import { useState } from 'react';
import { enablePublicMetrica, isTrackingAllowedLocation } from './metrica';

type Choice = 'unset' | 'accepted' | 'declined';

export default function PublicApp() {
  const [choice, setChoice] = useState<Choice>('unset');

  function allow(): void {
    // A real click is the only path that may start analytics.
    enablePublicMetrica();
    setChoice('accepted');
  }
  function decline(): void {
    setChoice('declined');
  }
  function revoke(): void {
    // Removing <script> does not undo JS already executed in this document.
    // A full document navigation destroys the Metrica execution context.
    window.location.replace('/');
  }

  return (
    <div className="public-shell">
      <header className="public-header">
        <a className="public-brand" href="/" aria-label="Нейрометр, главная">Нейрометр<span>.</span></a>
        <a className="public-nav" href="/viewer.html" rel="noreferrer">Приватный просмотрщик</a>
      </header>

      <main className="public-main">
        <div className="public-kicker">ЛОКАЛЬНАЯ ДИАГНОСТИКА ИИ</div>
        <h1>Узнайте возможности своего ПК.<br /><span>Без догадок и передачи отчёта.</span></h1>
        <p className="public-lead">Нейрометр помогает отличать обнаруженные устройства, оценки и реальные измерения.
          Диагностику создаёт отдельная локальная утилита, а отчёт открывается в защищённом браузерном документе.</p>
        <a className="public-cta" href="/viewer.html" rel="noreferrer">Открыть защищённый просмотрщик JSON</a>
        <p className="public-hint">Просмотрщик работает без обязательного сервера, учётной записи и сторонней аналитики.</p>

        <section className="public-features" aria-label="Принципы Нейрометра">
          <article><h2>Локальный файл</h2><p>Вы выбираете diagnostic.json на своём устройстве. Публичная страница не читает диагностические файлы.</p></article>
          <article><h2>Честные статусы</h2><p>«Обнаружено» не означает «проверено», а неизвестная память не превращается в ноль.</p></article>
          <article><h2>Отдельный документ</h2><p>При переходе в просмотрщик загружается новый HTML-документ без кода Яндекс.Метрики.</p></article>
        </section>

        <section className="public-consent" aria-label="Настройки аналитики">
          <h2>Необязательная аналитика посещений</h2>
          <p>Только на публичной странице, после вашего согласия, может загружаться Яндекс.Метрика
            (счётчик 114214620) для статистики посещений и просмотров. Сервис может использовать cookies
            и другие идентификаторы посетителя. Вебвизор, карта кликов и отслеживание ссылок выключены.
            Содержимое диагностических отчётов в Метрику не передаётся.</p>
          <p>Согласие действует только в текущем документе. После новой загрузки страницы оно запрашивается
            заново. Отказ не мешает пользоваться просмотрщиком.</p>
          {choice === 'unset' && (
            <div className="public-consent-actions">
              <button type="button" onClick={allow}>Разрешить аналитику</button>
              <button type="button" className="public-outline" onClick={decline}>Отказаться</button>
            </div>
          )}
          {choice === 'declined' && (
            <div className="public-consent-actions">
              <p role="status">Аналитика не разрешена. Сайт и просмотрщик доступны без неё.</p>
              <button type="button" onClick={allow}>Разрешить аналитику</button>
            </div>
          )}
          {choice === 'accepted' && (
            <div className="public-consent-actions">
              <p role="status">{isTrackingAllowedLocation()
                ? 'Согласие дано для этой публичной страницы. При блокировке счётчика сайт продолжит работать.'
                : 'Согласие дано, но счётчик не запускается на localhost, CI или другом домене.'}</p>
              <button type="button" className="public-outline" onClick={revoke}>Отозвать согласие</button>
            </div>
          )}
        </section>
      </main>
      <footer className="public-footer">Нейрометр · Статический сайт · Без загрузки диагностического JSON</footer>
    </div>
  );
}
