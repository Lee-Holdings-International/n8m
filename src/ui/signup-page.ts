
export const getSignupPageHtml = (supabaseUrl: string, supabaseKey: string, redirectUrl: string) => {
  const tokens = {
    colors: {
        bg: '#0F172A', // colors.background.value
        text: '#F1F5F9', // colors.foreground.value
        textMuted: '#94A3B8', // colors.mutedForeground.value
        primary: '#10B981', // colors.primary.value
        primaryHover: '#059669', // Derived emerald-dark
        onPrimary: '#0F172A', // colors.primaryForeground.value
        border: '#334155', // colors.border.value
        inputBg: '#1E293B', // colors.input.value
        cardBg: '#1E293B', // colors.card.value
        ring: '#10B981', // colors.ring.value
        error: '#EF4444', // colors.semantic.error.value
        // Logo specific tokens
        logoBg: 'rgba(16, 185, 129, 0.2)', // logo.colors.iconBackground
        logoBorder: '#10B981', // logo.colors.iconBorder
        logoIcon: '#10B981', // logo.colors.icon
    },
    spacing: {
        container: '2.5rem', // spacing.scale.5
        gap: '1.25rem', // slightly larger than 1rem for comfort
        inputPad: '0.75rem 1rem', // componentTokens.input
    },
    radius: '0.375rem', // borderRadius.md
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
      <title>Sign up for n8m</title>
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
          --spacing-container: ${tokens.spacing.container};
          
          /* Logo Tokens */
          --logo-bg: ${tokens.colors.logoBg};
          --logo-border: ${tokens.colors.logoBorder};
          --logo-icon: ${tokens.colors.logoIcon};
        }

        * { box-sizing: border-box; }
        
        body {
          margin: 0;
          padding: 0;
          background-color: var(--bg-primary);
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
          padding: 40px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          text-align: center;
          animation: fade-in 0.4s ease-out;
        }

        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* High Fidelity Logo Component */
        .logo-container {
          width: 4rem; /* sizes.lg.container */
          height: 4rem;
          margin: 0 auto 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          
          background-color: var(--logo-bg); /* colors.iconBackground */
          border: 2px solid var(--logo-border); /* borderWidth, colors.iconBorder */
          border-radius: 4px; /* borderRadius */
          color: var(--logo-icon); /* colors.icon */
        }
        
        .logo-icon {
            width: 32px; /* sizes.lg.icon */
            height: 32px;
        }

        h1 {
          font-size: 24px;
          font-weight: 600;
          margin: 0 0 8px;
          letter-spacing: -0.025em;
        }

        .subtext {
          color: var(--text-muted);
          font-size: 14px;
          margin-bottom: 32px;
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
          font-weight: 500;
          color: var(--text-primary);
        }

        input {
          background-color: var(--input-bg);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius);
          padding: 10px 12px;
          color: var(--text-primary);
          font-family: var(--font-ui);
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }

        input:focus {
          border-color: var(--focus-ring);
          box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
        }
        
        input::placeholder {
          color: #64748B;
        }

        .btn-primary {
          background-color: var(--brand-emerald);
          color: var(--text-on-brand);
          border: none;
          border-radius: var(--radius);
          padding: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s;
          margin-top: 8px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-primary:hover {
          background-color: var(--brand-emerald-dark);
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
            font-weight: 500;
        }

        .version-tag {
            font-family: var(--font-mono);
            font-size: 10px;
            color: #475569;
            margin-top: 32px;
        }
        
        #message {
            margin-top: 16px;
            font-size: 13px;
        }
        .error { color: var(--error); }
        .success { color: var(--brand-emerald); }

      </style>
    </head>
    <body>
      <div class="login-card">
        <div class="logo-container">
            <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
        </div>
        <h1>Create your account</h1>
        <div class="subtext">Get started with agentic workflows.</div>
        
        <form onsubmit="event.preventDefault(); handleSignup();">
            <div class="input-group">
                <label for="email">Email</label>
                <input type="email" id="email" placeholder="name@company.com" required />
            </div>
            
            <div class="input-group">
                <label for="password">Password</label>
                <input type="password" id="password" placeholder="••••••••" required />
            </div>

            <div class="input-group">
                <label for="confirm-password">Confirm Password</label>
                <input type="password" id="confirm-password" placeholder="••••••••" required />
            </div>
            
            <button type="submit" class="btn-primary" id="sign-up-btn">Create account</button>
        </form>
        
        <div id="message"></div>
        
        <div class="footer">
            Already have an account? <a href="/api/v1/auth/login">Sign in</a>
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
            
            if (!supabaseUrl) {
                // Mock Mode since env might be missing
                setTimeout(() => {
                    showMessage('Signup successful! Please check your email.', 'success');
                    btn.disabled = false;
                    btn.innerText = 'Create account';
                }, 800);
                return;
            }

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
