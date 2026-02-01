
export const getSuccessPageHtml = (apiKey: string) => {
  const tokens = {
    colors: {
        bg: '#0F172A', 
        text: '#F1F5F9',
        textMuted: '#94A3B8',
        success: '#10B981',
        primary: '#10B981',
        secondary: '#6366F1',
        border: '#334155',
        cardBg: '#1E293B',
        logoBg: 'rgba(16, 185, 129, 0.2)',
        logoBorder: '#10B981',
        logoIcon: '#10B981',
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

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>n8m | Access Verified</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-primary: ${tokens.colors.bg};
          --text-primary: ${tokens.colors.text};
          --text-muted: ${tokens.colors.textMuted};
          --brand-emerald: ${tokens.colors.success};
          --brand-indigo: ${tokens.colors.secondary};
          --border-subtle: ${tokens.colors.border};
          --card-bg: ${tokens.colors.cardBg};
          
          --font-ui: ${tokens.fonts.ui};
          --font-mono: ${tokens.fonts.mono};
          
          --radius-md: ${tokens.radius.md};
          --radius-lg: ${tokens.radius.lg};
          
          --logo-bg: ${tokens.colors.logoBg};
          --logo-border: ${tokens.colors.logoBorder};
          --logo-icon: ${tokens.colors.logoIcon};
        }

        * { box-sizing: border-box; }
        
        body {
          margin: 0;
          padding: 0;
          background-color: var(--bg-primary);
          background-image: radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.05) 0%, transparent 50%);
          color: var(--text-primary);
          font-family: var(--font-ui);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
        }

        .success-card {
          background-color: var(--card-bg);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 48px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          text-align: center;
          animation: slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }

        .success-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, var(--brand-emerald), var(--brand-indigo));
        }

        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .logo-container {
          width: 4.5rem;
          height: 4.5rem;
          margin: 0 auto 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--logo-bg);
          border: 2px solid var(--logo-border);
          border-radius: 50%;
          color: var(--logo-icon);
          box-shadow: 0 0 30px rgba(16, 185, 129, 0.2);
          animation: scale-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        @keyframes scale-in {
            from { transform: scale(0.5); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }

        .logo-icon {
            width: 36px;
            height: 36px;
        }

        h1 {
          font-size: 1.5rem; /* Token: fontSize.2xl */
          font-weight: 700;
          margin: 0 0 8px;
          letter-spacing: -0.025em;
          color: var(--text-primary);
        }

        .subtext {
          color: var(--text-muted);
          font-size: 15px;
          margin-bottom: 32px;
          line-height: 1.6;
        }
        
        .token-display {
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid var(--border-subtle);
            border-radius: var(--radius-md);
            padding: 16px;
            margin-bottom: 32px;
            text-align: left;
            position: relative;
        }

        .token-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.1em;
            margin-bottom: 8px;
            display: block;
        }

        .token-value {
            font-family: var(--font-mono);
            font-size: 13px;
            color: var(--brand-emerald);
            word-break: break-all;
            display: block;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(16, 185, 129, 0.1);
            color: var(--brand-emerald);
            padding: 6px 12px;
            border-radius: 9999px; // full
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 24px;
            border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-dot {
            width: 6px;
            height: 6px;
            background: var(--brand-emerald);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--brand-emerald);
        }

        .footer {
          margin-top: 12px;
          font-size: 14px;
          color: var(--text-muted);
        }
        
        .countdown {
            font-family: var(--font-mono);
            font-weight: 600;
            color: var(--brand-indigo);
        }

        .version-tag {
            font-family: var(--font-mono);
            font-size: 10px;
            color: #334155;
            margin-top: 48px;
            letter-spacing: 0.1em;
        }

      </style>
    </head>
    <body>
      <div class="success-card">
        <div class="logo-container">
            <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </div>
        
        <h1>Connected</h1>
        <div class="subtext">You are logged in to the system.</div>

        <div class="footer">
            Closing in <span id="timer" class="countdown">3</span>s...
        </div>
      </div>

      <script>
          let count = 3;
          const timerEl = document.getElementById('timer');
          const interval = setInterval(() => {
              count--;
              timerEl.innerText = count;
              if (count <= 0) {
                  clearInterval(interval);
                  window.close();
                  // Fallback for browsers that block script-initiated close
                  timerEl.parentElement.innerHTML = 'You may now close this tab.';
              }

          }, 1000);
      </script>
    </body>
    </html>
  `;
};
