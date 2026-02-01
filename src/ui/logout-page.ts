
export const getLogoutPageHtml = (supabaseUrl: string, supabaseKey: string) => {

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
        logoBg: 'rgba(239, 68, 68, 0.2)',
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

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>n8m | Session Terminated</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-primary: ${tokens.colors.bg};
          --text-primary: ${tokens.colors.text};
          --text-muted: ${tokens.colors.textMuted};
          --brand-error: ${tokens.colors.error};
          --brand-emerald: ${tokens.colors.primary};
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
          background-image: radial-gradient(circle at 50% 50%, rgba(239, 68, 68, 0.05) 0%, transparent 50%);
          color: var(--text-primary);
          font-family: var(--font-ui);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
        }

        .logout-card {
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

        .logout-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, var(--brand-error), var(--brand-indigo));
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
          box-shadow: 0 0 30px rgba(239, 68, 68, 0.2);
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
          font-size: 26px;
          font-weight: 700;
          margin: 0 0 8px;
          letter-spacing: -0.025em;
          background: linear-gradient(135deg, var(--brand-error) 0%, #fff 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .subtext {
          color: var(--text-muted);
          font-size: 15px;
          margin-bottom: 32px;
          line-height: 1.6;
        }
        
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(239, 68, 68, 0.1);
            color: var(--brand-error);
            padding: 6px 12px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 24px;
            border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .status-dot {
            width: 6px;
            height: 6px;
            background: var(--brand-error);
            border-radius: 50%;
            box-shadow: 0 0 8px var(--brand-error);
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
      <div class="logout-card">
        <div class="logo-container">
            <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                <line x1="12" y1="2" x2="12" y2="12"></line>
            </svg>
        </div>
        
        <div class="status-badge">
            <span class="status-dot"></span>
            SESSION TERMINATED
        </div>
        
        <h1>Handshake Severed</h1>
        <div class="subtext">The local secure session has been destroyed. Your identity has been scrubbed from this terminal.</div>
        
        <div class="footer">
            Terminating session in <span id="timer" class="countdown">3</span>s...
        </div>
        
        <div class="version-tag">SYSTEM v0.0.1 // CHANNEL_CLOSED</div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
      <script>
          const supabaseUrl = '${supabaseUrl}';
          const supabaseKey = '${supabaseKey}';
          
          if (supabaseUrl && supabaseKey) {
              const client = supabase.createClient(supabaseUrl, supabaseKey);
              client.auth.signOut().then(() => {
                  console.log('Web session terminated.');
                  // Clear local storage just in case
                  localStorage.clear();
              }).catch(err => {
                  console.error('Sign out error:', err);
              });
          }

          let count = 3;
          const timerEl = document.getElementById('timer');
          const interval = setInterval(() => {
              count--;
              if (timerEl) timerEl.innerText = count;
              if (count <= 0) {
                  clearInterval(interval);
                  window.close();
                  // Fallback for browsers that block script-initiated close
                  const container = document.querySelector('.logout-card');
                  if (container) {
                      container.innerHTML = \`
                          <div class="logo-container">
                              <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                          </div>
                          <h1>Handshake Severed</h1>
                          <div class="subtext">Session concluded. You may safely close this tab.</div>
                          <div class="version-tag">SYSTEM v0.0.1 // CHANNEL_CLOSED</div>
                      \`;
                  }
              }
          }, 1000);
      </script>

    </body>
    </html>
  `;
};
