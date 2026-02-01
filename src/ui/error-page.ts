
export const getErrorPageHtml = (error: { 
    title?: string, 
    message: string, 
    code?: string | number,
    retryUrl?: string,
    retryText?: string 
}) => {
    const tokens = {
        colors: {
            bg: '#0F172A',
            text: '#F1F5F9',
            textMuted: '#94A3B8',
            error: '#EF4444',
            primary: '#10B981',
            secondary: '#6366F1',
            border: '#334155',
            cardBg: '#1E293B',
            logoBg: 'rgba(239, 68, 68, 0.1)',
            logoBorder: '#EF4444',
            logoIcon: '#EF4444',
        },
        radius: {
            md: '0.375rem',
            lg: '0.50rem',
        },
        fonts: {
            ui: "'Inter', system-ui, -apple-system, sans-serif",
            mono: "'JetBrains Mono', monospace",
        }
    };

    const title = error.title || 'System Alert';
    const code = error.code || 'ERR_GENERIC';
    const retryUrl = error.retryUrl || '/api/v1/auth/login';
    const retryText = error.retryText || 'Return to Safety';

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>n8m | ${title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: ${tokens.colors.bg};
                --text: ${tokens.colors.text};
                --text-muted: ${tokens.colors.textMuted};
                --error: ${tokens.colors.error};
                --primary: ${tokens.colors.primary};
                --secondary: ${tokens.colors.secondary};
                --border: ${tokens.colors.border};
                --card-bg: ${tokens.colors.cardBg};
                --font-ui: ${tokens.fonts.ui};
                --font-mono: ${tokens.fonts.mono};
                --radius-md: ${tokens.radius.md};
                --radius-lg: ${tokens.radius.lg};
            }

            * { box-sizing: border-box; }
            body {
                margin: 0;
                padding: 0;
                background-color: var(--bg);
                background-image: radial-gradient(circle at 50% 50%, rgba(239, 68, 68, 0.05) 0%, transparent 50%);
                color: var(--text);
                font-family: var(--font-ui);
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                -webkit-font-smoothing: antialiased;
            }

            .error-card {
                background-color: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: var(--radius-lg);
                padding: 3rem;
                width: 100%;
                max-width: 440px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                text-align: center;
                animation: scale-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                position: relative;
                overflow: hidden;
            }

            .error-card::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 2px;
                background: linear-gradient(90deg, var(--error), var(--secondary));
            }

            @keyframes scale-up {
                from { opacity: 0; transform: scale(0.95); }
                to { opacity: 1; transform: scale(1); }
            }

            .icon-container {
                width: 4rem;
                height: 4rem;
                margin: 0 auto 1.5rem;
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: ${tokens.colors.logoBg};
                border: 2px solid var(--error);
                border-radius: 12px;
                color: var(--error);
                box-shadow: 0 0 20px rgba(239, 68, 68, 0.2);
            }

            h1 {
                font-size: 1.5rem;
                font-weight: 700;
                margin: 0 0 0.5rem;
                letter-spacing: -0.025em;
            }

            .message {
                color: var(--text-muted);
                font-size: 0.9375rem;
                line-height: 1.6;
                margin-bottom: 2rem;
            }

            .code-badge {
                display: inline-block;
                font-family: var(--font-mono);
                font-size: 0.75rem;
                background: rgba(0, 0, 0, 0.3);
                border: 1px solid var(--border);
                padding: 4px 8px;
                border-radius: 4px;
                margin-bottom: 2rem;
                color: var(--text-muted);
            }

            .btn-primary {
                display: block;
                background: var(--primary);
                color: var(--bg);
                border: none;
                border-radius: var(--radius-md);
                padding: 0.75rem 1rem;
                font-size: 0.875rem;
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
                transition: all 0.2s;
            }

            .btn-primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                filter: brightness(1.1);
            }

            .version-tag {
                font-family: var(--font-mono);
                font-size: 0.625rem;
                color: #334155;
                margin-top: 3rem;
                letter-spacing: 0.1em;
            }
        </style>
    </head>
    <body>
        <div class="error-card">
            <div class="icon-container">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
            </div>
            <h1>${title}</h1>
            <div class="code-badge">${code}</div>
            <div class="message">${error.message}</div>
            <a href="${retryUrl}" class="btn-primary">${retryText}</a>
            <div class="version-tag">SYSTEM v0.0.1 // CHANNEL_ERROR</div>
        </div>
    </body>
    </html>
    `;
};
