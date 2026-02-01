
export const getSignupPageHtml = (supabaseUrl: string, supabaseKey: string, redirectUrl: string) => {
  const tokens = {
    colors: {
        bg: '#0F172A', 
        text: '#F1F5F9',
        textMuted: '#94A3B8',
        primary: '#10B981',
        secondary: '#6366F1',
        primaryHover: '#059669',
        onPrimary: '#0F172A',
        border: '#334155',
        inputBg: '#1E293B',
        cardBg: '#1E293B',
        ring: '#10B981',
        error: '#EF4444',
        ai: '#A855F7',
        logoBg: 'rgba(16, 185, 129, 0.1)',
        logoBorder: '#10B981',
        logoIcon: '#10B981',
    },
    radius: '0.375rem',
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
      <title>n8m | Register Profile</title>
      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-primary: ${tokens.colors.bg};
          --text-primary: ${tokens.colors.text};
          --text-muted: ${tokens.colors.textMuted};
          --brand-emerald: ${tokens.colors.primary};
          --brand-indigo: ${tokens.colors.secondary};
          --brand-ai: ${tokens.colors.ai};
          --brand-emerald-dark: ${tokens.colors.primaryHover};
          --text-on-brand: ${tokens.colors.onPrimary};
          --border-subtle: ${tokens.colors.border};
          --input-bg: ${tokens.colors.inputBg};
          --card-bg: ${tokens.colors.cardBg};
          --focus-ring: ${tokens.colors.ring};
          --error: ${tokens.colors.error};
          
          --font-ui: ${tokens.fonts.ui};
          --font-mono: ${tokens.fonts.mono};
          
          --radius: ${tokens.radius};
          
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

        .login-card {
          background-color: var(--card-bg);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 48px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          text-align: center;
          animation: slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }

        .login-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, var(--brand-emerald), var(--brand-ai));
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
          border: 1px solid var(--logo-border);
          border-radius: 8px;
          color: var(--logo-icon);
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
          color: #fff;
        }

        .subtext {
          color: var(--text-muted);
          font-size: 14px;
          margin-bottom: 36px;
          line-height: 1.5;
        }
        
        form {
          display: flex;
          flex-direction: column;
          gap: 16px; 
          text-align: left;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        input {
          background-color: rgba(15, 23, 42, 0.5);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius);
          padding: 12px;
          color: var(--text-primary);
          font-family: var(--font-ui);
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
        }

        input:focus {
          border-color: var(--brand-emerald);
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.1);
        }

        .btn-primary {
          background: linear-gradient(135deg, var(--brand-emerald) 0%, #059669 100%);
          color: var(--text-on-brand);
          border: none;
          border-radius: var(--radius);
          padding: 12px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: filter 0.2s;
          margin-top: 10px;
          height: 44px;
        }

        .btn-primary:hover {
          filter: brightness(1.1);
        }

        .footer {
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid var(--border-subtle);
          font-size: 14px;
          color: var(--text-muted);
        }
        
        .footer a {
            color: var(--brand-emerald);
            text-decoration: none;
            font-weight: 600;
        }

        .version-tag {
            font-family: var(--font-mono);
            font-size: 10px;
            color: #334155;
            margin-top: 32px;
        }
        
        #message {
            margin-top: 16px;
            font-size: 13px;
            padding: 10px;
            border-radius: 4px;
        }
        .error { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); }
        .success { background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); }

      </style>
    </head>
    <body>
      <div class="login-card">
        <div class="logo-container">
            <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
        </div>
        <h1>Create Operative ID</h1>
        <div class="subtext">Join the decentralized automation network.</div>
        
        <form onsubmit="event.preventDefault(); handleSignup();">
            <div class="input-group">
                <label for="email">Email Address</label>
                <input type="email" id="email" placeholder="name@company.com" required />
            </div>
            
            <div class="input-group">
                <label for="password">Security Token (Password)</label>
                <input type="password" id="password" placeholder="••••••••" required />
            </div>

            <div class="input-group">
                <label for="confirm-password">Confirm Token</label>
                <input type="password" id="confirm-password" placeholder="••••••••" required />
            </div>
            
            <button type="submit" class="btn-primary" id="sign-up-btn">Create account</button>
        </form>
        
        <div id="message"></div>
        
        <div class="footer">
            Already verified? <a href="/api/v1/auth/login">Sign in</a>
        </div>
        
        <div class="version-tag">n8m v0.0.1 Beta</div>
      </div>

      <script>
          const supabaseUrl = '${supabaseUrl}';
          const supabaseKey = '${supabaseKey}';

          const showMessage = (msg, type = 'neutral') => {
              const el = document.getElementById('message');
              el.innerText = msg;
              el.className = type;
              el.style.display = 'block';
          };

          const client = supabase.createClient(supabaseUrl, supabaseKey);

          async function handleSignup() {
            const btn = document.getElementById('sign-up-btn');
            const pass = document.getElementById('password').value;
            const confirm = document.getElementById('confirm-password').value;
            const email = document.getElementById('email').value;

            if (pass !== confirm) {
                showMessage("Passwords do not match", 'error');
                return;
            }

            btn.disabled = true;
            btn.innerText = 'Creating account...';
            
            const { error } = await client.auth.signUp({
                email,
                password: pass,
                options: {
                    emailRedirectTo: '${redirectUrl}' || window.location.origin + '/api/v1/auth/login'
                }
            });

            btn.disabled = false;
            btn.innerText = 'Create account';

            if (error) {
                showMessage(error.message, 'error');
            } else {
                showMessage('Account created! Please check your email to confirm.', 'success');
            }
          }
      </script>
    </body>
    </html>
  `;
};
