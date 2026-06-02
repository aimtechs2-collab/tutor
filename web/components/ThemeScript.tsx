/**
 * ThemeScript - Initializes theme from localStorage before React hydration.
 * Render as a server-side inline script to avoid introducing a client chunk
 * dependency into the root layout (which can surface as ChunkLoadError when
 * the app/layout client chunk fails to load in dev).
 */
export default function ThemeScript() {
  const themeScript = `
    (function() {
      try {
        const stored = localStorage.getItem('aimtutor-theme');

        document.documentElement.classList.remove('dark', 'theme-glass', 'theme-snow');

        if (stored === 'dark') {
          document.documentElement.classList.add('dark');
        } else if (stored === 'glass') {
          document.documentElement.classList.add('dark', 'theme-glass');
        } else if (stored === 'snow') {
          document.documentElement.classList.add('theme-snow');
        } else if (stored === 'light') {
          // already clean
        } else {
          if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('aimtutor-theme', 'dark');
          } else {
            localStorage.setItem('aimtutor-theme', 'light');
          }
        }
      } catch (e) {
        /* localStorage may be disabled */
      }
    })();
  `;

  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
