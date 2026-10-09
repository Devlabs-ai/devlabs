import React from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ModuleWorkspace } from './ProjectModulePage';
import { ReadingSection, RichText } from './K8sReadingPage';
import { MINORS, MINORS_PATH, getMinor, getMinorChapter, type MinorEntry } from '../constants/minors';
import type { ProjectModule } from '../constants/projects';
import { K8S_BLOG_STAMP_SRC } from '../constants/k8sReadings';
import { LANGUAGE_LABELS, isLanguageId, type LanguageId } from '../constants/languages';
import {
  getMinorChapterContent,
  getMinorContent,
  getMinorReading,
  hasMinorChapterContent,
  hasMinorContent,
  type ChapterReading,
} from '../fixtures/projectModules';
import NotifyButton from '../components/NotifyButton';
import ChapterList from '../components/ChapterList';
import { useIsAdmin } from '../components/AdminOnlyRoute';

function minorLanguages(minor: MinorEntry): LanguageId[] {
  return minor.languages && minor.languages.length > 0 ? minor.languages : ['go'];
}

function languageStorageKey(minor: MinorEntry): string {
  return `devsetu.minor.${minor.id}.language`;
}

/**
 * The language a learner is building a minor in: `?lang=` first, then the
 * last one they picked for this minor, then the minor's default.
 */
function useMinorLanguage(minor: MinorEntry | null): [LanguageId, (lang: LanguageId) => void] {
  const [params, setParams] = useSearchParams();
  const languages = minor ? minorLanguages(minor) : (['go'] as LanguageId[]);
  const fromUrl = params.get('lang');
  let stored: string | null = null;
  try {
    stored = minor ? window.localStorage.getItem(languageStorageKey(minor)) : null;
  } catch {
    // ignore
  }
  const pick = [fromUrl, stored].find(
    (value): value is LanguageId => isLanguageId(value) && languages.includes(value),
  );
  const language = pick || languages[0];

  const setLanguage = (lang: LanguageId): void => {
    if (!minor) return;
    try {
      window.localStorage.setItem(languageStorageKey(minor), lang);
    } catch {
      // ignore
    }
    const next = new URLSearchParams(params);
    next.set('lang', lang);
    setParams(next, { replace: true });
  };
  return [language, setLanguage];
}

function chapterOpen(minor: MinorEntry, chapter: ProjectModule, language: LanguageId): boolean {
  if (chapter.status !== 'ready') return false;
  return chapter.kind === 'reading'
    ? getMinorReading(minor.id, chapter.id) != null
    : hasMinorChapterContent(minor.id, chapter.id, language);
}

function hasAuthoredContent(minor: MinorEntry): boolean {
  if (minor.chapters) {
    return minorLanguages(minor).some((lang) =>
      (minor.chapters || []).some((c) => chapterOpen(minor, c, lang)),
    );
  }
  return hasMinorContent(minor.id);
}

function LanguagePicker({
  minor,
  language,
  onChange,
}: {
  minor: MinorEntry;
  language: LanguageId;
  onChange: (lang: LanguageId) => void;
}): JSX.Element | null {
  const languages = minorLanguages(minor);
  if (languages.length < 2) return null;
  return (
    <div className="project-language-picker">
      <span className="project-language-picker-label">Build it in</span>
      <div className="app-segmented-tabs" role="radiogroup" aria-label="Language">
        {languages.map((lang) => (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={lang === language}
            className={`app-segmented-tab${lang === language ? ' active' : ''}`}
            onClick={() => onChange(lang)}
          >
            {LANGUAGE_LABELS[lang]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Admins can open planned minors that already have authored content, to review them before launch. */
function canOpen(minor: MinorEntry, isAdmin: boolean): boolean {
  return (minor.status === 'ready' || isAdmin) && hasAuthoredContent(minor);
}

function MinorsIndex({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  return (
    <div className="app-page play-problems-page">
      <header className="play-problems-hero">
        <div className="play-problems-hero-copy">
          <h1 className="play-problems-title">Minors</h1>
          <p className="play-problems-lead">
            Small independent builds — a listener, a protocol, a storage engine. Each one is a
            working program you can run and break on its own; the bigger ones come in a few
            chapters.
          </p>
        </div>
      </header>

      <section className="playgrounds-grid">
        {MINORS.map((minor) => {
          if (!canOpen(minor, isAdmin)) {
            return (
              <div key={minor.id} className="playground-tile playground-tile--soon">
                <strong className="playground-tile-title">
                  {minor.name}
                  <span className="playground-tile-soon">Coming soon</span>
                  <NotifyButton kind="minor" itemId={minor.id} label={minor.name} />
                </strong>
                <p className="project-tile-subtitle">{minor.subtitle}</p>
                <p className="playground-tile-blurb">{minor.blurb}</p>
                <ul className="playground-tile-facts">
                  {minor.facts.map((fact) => (
                    <li key={fact} className="playground-tile-fact">
                      {fact}
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
          return (
            <Link key={minor.id} to={`${MINORS_PATH}/${minor.id}`} className="playground-tile">
              <strong className="playground-tile-title">
                {minor.name}
                {minor.status !== 'ready' && <span className="playground-tile-soon">Admin preview</span>}
              </strong>
              <p className="project-tile-subtitle">{minor.subtitle}</p>
              <p className="playground-tile-blurb">{minor.blurb}</p>
              <ul className="playground-tile-facts">
                {minor.language && <li className="playground-tile-fact">{minor.language}</li>}
                {minor.facts.map((fact) => (
                  <li key={fact} className="playground-tile-fact">
                    {fact}
                  </li>
                ))}
              </ul>
              <span className="playground-tile-cta">
                Open {minor.name}
                <span aria-hidden>→</span>
              </span>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

function MinorDetail({
  minor,
  language,
  onLanguageChange,
}: {
  minor: MinorEntry;
  language: LanguageId;
  onLanguageChange: (lang: LanguageId) => void;
}): JSX.Element {
  return (
    <div className="app-page play-problems-page project-detail--list">
      <header className="project-detail-compact">
        <p className="play-papers-crumb">
          <Link to={MINORS_PATH}>Minors</Link>
          <span aria-hidden> / </span>
          <span>{minor.name}</span>
        </p>
        <h1 className="project-detail-compact-title">
          {minor.name}
          {minor.status !== 'ready' && (
            <span className="playground-tile-soon project-soon-badge">Admin preview</span>
          )}
        </h1>
        <p className="project-detail-subtitle">{minor.subtitle}</p>
      </header>

      <div className="project-about">
        {minor.about.map((paragraph) => (
          <p key={paragraph.slice(0, 48)} className="project-about-body">
            {paragraph}
          </p>
        ))}
      </div>

      <LanguagePicker minor={minor} language={language} onChange={onLanguageChange} />

      <ChapterList
        chapters={minor.chapters || []}
        isOpen={(chapter) => chapterOpen(minor, chapter, language)}
        hrefFor={(chapter) => `${MINORS_PATH}/${minor.id}/${chapter.id}?lang=${language}`}
      />
    </div>
  );
}

/** Reading chapters render in the same blog layout as track readings. */
function MinorReading({
  minor,
  chapter,
  reading,
  language,
}: {
  minor: MinorEntry;
  chapter: ProjectModule;
  reading: ChapterReading;
  language: LanguageId;
}): JSX.Element {
  const minorPath = `${MINORS_PATH}/${minor.id}`;
  const chapters = minor.chapters || [];
  const index = chapters.findIndex((c) => c.id === chapter.id);
  const firstNumber = chapters[0]?.kind === 'reading' ? 0 : 1;
  const next = chapters.slice(index + 1).find((c) => chapterOpen(minor, c, language));
  const nextNumber = next ? String(chapters.indexOf(next) + firstNumber).padStart(2, '0') : '';
  const prefix = `minor/${minor.id}/${chapter.id}`;

  return (
    <div className="app-page spark-primer-page">
      <article
        className={`spark-primer-notebook${reading.showBlogStamp ? ' spark-primer-notebook--stamped' : ''}`}
      >
        {reading.showBlogStamp ? (
          <img
            className="spark-primer-blog-stamp"
            src={K8S_BLOG_STAMP_SRC}
            alt="The DevSetu Blog"
            width={88}
            height={88}
            decoding="async"
          />
        ) : null}
        <header className="spark-primer-header">
          <p className="spark-primer-crumb">
            <Link to={MINORS_PATH}>Minors</Link>
            <span aria-hidden> / </span>
            <Link to={minorPath}>{minor.name}</Link>
            <span aria-hidden> / </span>
            {chapter.label}
          </p>
          <p className="spark-primer-eyebrow">{reading.eyebrow}</p>
          <h1 className="spark-primer-title">{reading.title}</h1>
          <p className="spark-primer-lede">
            <RichText text={reading.lede} />
          </p>
        </header>

        <nav className="spark-primer-toc" aria-label="On this page">
          {reading.sections
            .filter((s) => s.title)
            .map((section) => (
              <a key={section.id} href={`#${section.id}`}>
                {section.title}
              </a>
            ))}
          <a href="#takeaways">Takeaways</a>
        </nav>

        {reading.sections.map((section) => (
          <ReadingSection key={section.id} section={section} readingPrefix={prefix} />
        ))}

        <section id="takeaways" className="spark-primer-section">
          <p className="spark-primer-section-eyebrow">Takeaways</p>
          <h2 className="spark-primer-section-title">What to keep</h2>
          <ul className="spark-primer-example-list spark-primer-bullets">
            {reading.takeaways.map((item) => (
              <li key={item}>
                <RichText text={item} />
              </li>
            ))}
          </ul>
        </section>

        <section className="spark-primer-section spark-primer-next">
          <p className="spark-primer-section-eyebrow">In this minor</p>
          <h2 className="spark-primer-section-title">{next ? 'Up next' : 'Chapters'}</h2>
          <ul className="spark-primer-links">
            <li>
              {next ? (
                <Link to={`${minorPath}/${next.id}?lang=${language}`}>
                  Chapter {nextNumber} · {next.label}: {next.subtitle}
                </Link>
              ) : (
                <Link to={minorPath}>All {minor.name} chapters</Link>
              )}
            </li>
            {next ? (
              <li>
                <Link to={minorPath}>All {minor.name} chapters</Link>
              </li>
            ) : null}
          </ul>
        </section>
      </article>
    </div>
  );
}

export default function MinorsPage(): JSX.Element {
  const { minorId, chapterId } = useParams<{ minorId?: string; chapterId?: string }>();
  const isAdmin = useIsAdmin();
  const minor = getMinor(minorId);
  const [language, setLanguage] = useMinorLanguage(minor);

  if (!minorId) return <MinorsIndex isAdmin={isAdmin} />;
  if (!minor || !canOpen(minor, isAdmin)) return <Navigate to={MINORS_PATH} replace />;
  const minorPath = `${MINORS_PATH}/${minor.id}`;

  if (minor.chapters) {
    if (!chapterId) {
      return <MinorDetail minor={minor} language={language} onLanguageChange={setLanguage} />;
    }
    const chapter = getMinorChapter(minor, chapterId);
    if (!chapter || !chapterOpen(minor, chapter, language)) {
      return <Navigate to={`${minorPath}?lang=${language}`} replace />;
    }
    if (chapter.kind === 'reading') {
      const reading = getMinorReading(minor.id, chapter.id);
      if (!reading) return <Navigate to={minorPath} replace />;
      return <MinorReading minor={minor} chapter={chapter} reading={reading} language={language} />;
    }
    const content = getMinorChapterContent(minor.id, chapter.id, language);
    if (!content) return <Navigate to={minorPath} replace />;
    // Go keeps the id it had before other languages existed, so saved work survives.
    const languageSuffix = language === 'go' ? '' : `.${language}`;
    return (
      <ModuleWorkspace
        persistId={`minor.${minor.id}.${chapter.id}${languageSuffix}`}
        content={content}
        trail={[
          { to: MINORS_PATH, label: 'Minors' },
          { to: `${minorPath}?lang=${language}`, label: minor.name },
        ]}
        title={`${chapter.label} · ${LANGUAGE_LABELS[language]}`}
      />
    );
  }

  if (chapterId) return <Navigate to={minorPath} replace />;
  const content = getMinorContent(minor.id);
  if (!content) return <Navigate to={MINORS_PATH} replace />;

  return (
    <ModuleWorkspace
      persistId={`minor.${minor.id}.v2`}
      content={content}
      trail={[{ to: MINORS_PATH, label: 'Minors' }]}
      title={minor.name}
    />
  );
}
