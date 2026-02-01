
export const getLoginPageHtml = (supabaseUrl: string, supabaseKey: string, redirectUrl: string, shouldReauth: boolean = false) => {
  const tokens = {
    colors: {
        bg: '#0F172A', 
        text: '#F1F5F9',
        textMuted: '#94A3B8',
        primary: '#10B981',
        secondary: '#6366F1',
        border: '#334155',
        cardBg: '#1E293B',
        ring: '#10B981',
        error: '#EF4444',
        ai: '#A855F7',
        logoBg: 'rgba(16, 185, 129, 0.2)',
        logoBorder: '#10B981',
        logoIcon: '#10B981',
    },
    spacing: {
        container: '3rem', // scale.6
        gap: '1.25rem',
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
      <title>n8m | Access Terminal</title>
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
          --text-on-brand: ${tokens.colors.bg}; /* primaryForeground */
          --border-subtle: ${tokens.colors.border};
          --card-bg: ${tokens.colors.cardBg};
          --focus-ring: ${tokens.colors.ring};
          --error: ${tokens.colors.error};
          
          --font-ui: ${tokens.fonts.ui};
          --font-mono: ${tokens.fonts.mono};
          
          --radius-md: ${tokens.radius.md};
          --radius-lg: ${tokens.radius.lg};
          
          /* Token: spacing.scale.3 (24px) or 6 (48px) */
          --spacing-container: 3rem; 
          
          /* Token: shadows.lg */
          --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          /* Token: shadows.glow.emerald */
          --shadow-glow: 0 0 20px rgba(16, 185, 129, 0.3);

          --logo-bg: rgba(16, 185, 129, 0.2);
          --logo-border: ${tokens.colors.primary};
          --logo-icon: ${tokens.colors.primary};
        }

        * { box-sizing: border-box; }
        
        body {
          margin: 0;
          padding: 0;
          background-color: var(--bg-primary);
          background-image: radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.05) 0%, transparent 50%);
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
          border-radius: var(--radius-lg);
          padding: 3rem; /* Token: spacing.scale.6 */
          width: 100%;
          max-width: 440px;
          box-shadow: var(--shadow-lg);
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
            background: linear-gradient(90deg, var(--brand-emerald), var(--brand-indigo));
        }

        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .logo-container {
          width: 4rem; /* Token: logo.sizes.lg.container */
          height: 4rem;
          margin: 0 auto 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--logo-bg);
          border: 2px solid var(--logo-border);
          border-radius: 4px; /* Token: logo.borderRadius */
          color: var(--logo-icon);
          box-shadow: var(--shadow-glow);
        }
        
        .logo-icon {
            width: 32px; /* Token: logo.sizes.lg.icon */
            height: 32px;
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
          font-size: 14px;
          margin-bottom: 36px;
          line-height: 1.5;
        }
        
        form {
          display: flex;
          flex-direction: column;
          gap: 20px; 
          text-align: left;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        input {
          background-color: rgba(15, 23, 42, 0.5);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 12px 16px;
          color: var(--text-primary);
          font-family: var(--font-ui);
          font-size: 15px;
          outline: none;
          transition: all 0.2s ease;
        }

        input:focus {
          border-color: var(--brand-indigo);
          background-color: rgba(15, 23, 42, 0.8);
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15);
        }
        
        input::placeholder {
          color: #475569;
        }

        .btn-primary {
          background: var(--brand-emerald);
          color: var(--text-on-brand);
          border: none;
          border-radius: var(--radius-md); /* 4px in button token? Token says 4px, radius-md is 6px. Override? Token says borderRadius 4px. */
          border-radius: 4px; 
          padding: 0.5rem 1rem; /* Token: button.padding */
          font-size: 0.875rem; /* Token: fontSize.sm (Standard for UI?) or medium? Token doesn't specify size, but 15px was old. */
          font-weight: 500; /* Token: button.fontWeight */
          cursor: pointer;
          transition: 200ms; /* Token: button.transition */
          margin-top: 10px;
          min-height: 44px; /* Token: button.minHeight */
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }


        .btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(99, 102, 241, 0.3);
          filter: brightness(1.1);
        }

        .btn-primary:active {
            transform: translateY(0);
        }

        .footer {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          font-size: 14px;
          color: var(--text-muted);
        }
        
        .footer a {
            color: var(--brand-emerald);
            text-decoration: none;
            font-weight: 600;
            transition: color 0.2s;
        }
        
        .footer a:hover {
            color: var(--brand-emerald-dark);
            text-decoration: underline;
        }

        .version-tag {
            font-family: var(--font-mono);
            font-size: 10px;
            color: #334155;
            margin-top: 32px;
            letter-spacing: 0.1em;
        }
        
        #message {
            margin-top: 20px;
            font-size: 14px;
            font-weight: 500;
            padding: 12px;
            border-radius: 6px;
            display: none;
            animation: fade-in 0.3s ease;
        }
        #message.error { 
            display: block;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.2);
            color: #f87171; 
        }
        #message.success { 
            display: block;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            color: #34d399; 
        }
        #message.neutral {
            display: block;
            background: rgba(148, 163, 184, 0.1);
            border: 1px solid rgba(148, 163, 184, 0.2);
            color: var(--text-muted);
        }

        /* Pulsing indicator for "Authenticating" */
        .pulse {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--brand-ai);
            margin-right: 8px;
            animation: pulse-ring 1.5s cubic-bezier(0.455, 0.03, 0.515, 0.955) infinite;
        }

        @keyframes pulse-ring {
            0% { transform: scale(0.8); opacity: 0.5; }
            50% { transform: scale(1.2); opacity: 1; }
            100% { transform: scale(0.8); opacity: 0.5; }
        }

      </style>
    </head>
    <body>
      <div class="login-card">
        <div class="logo-container">
            <svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
        </div>
        
        <div id="auth-form-container">
            <h1>Log in to n8m</h1>
            <div class="subtext">Sign in to your account.</div>
            
            <form onsubmit="event.preventDefault(); handleLogin();">
                <div class="input-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" placeholder="name@company.com" required />
                </div>
                
                <div class="input-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" placeholder="••••••••" />
                </div>
                
                <button type="submit" class="btn-primary" id="sign-in-btn">Sign In</button>
            </form>
            
            <div id="message"></div>
            
            <div class="footer">
                Don't have an account? <a href="/api/v1/auth/signup">Sign up</a>
            </div>
        </div>

        <div id="session-confirm-container" style="display: none;">
            <h1>Welcome Back</h1>
            <div class="subtext" id="user-welcome-text">Logged in as user.</div>
            
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button onclick="authorizeCli()" class="btn-primary" id="confirm-btn">Authorize CLI</button>
                <button onclick="switchAccount()" class="btn-primary" style="background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); margin-top: 0; box-shadow: none;">Switch Account</button>
            </div>

            <div id="confirm-message"></div>
        </div>
        
        <div class="version-tag">SYSTEM v0.0.1 // BETA-BETA</div>
      </div>

      <script>
          const supabaseUrl = '${supabaseUrl}';
          const supabaseKey = '${supabaseKey}';
          const redirectFn = (key) => {
             if ('${redirectUrl}') {
                window.location.href = '${redirectUrl}?key=' + key;
             } else {
                showSimpleMessage('Identity Verified. CLI Token: ' + key, 'success');
             }
          };

          const showSimpleMessage = (msg, type = 'neutral', elementId = 'message') => {
              const el = document.getElementById(elementId);
              el.innerHTML = (type === 'neutral' ? '<span class="pulse"></span>' : '') + msg;
              el.className = type;
              el.style.display = 'block';
          };

          const client = supabase.createClient(supabaseUrl, supabaseKey);

          // Force fresh login if requested (e.g. from CLI after logout)
          const shouldReauth = ${shouldReauth};

          // Check for existing session and validate with server
          async function checkSession() {
              if (shouldReauth) {
                 await client.auth.signOut();
                 // Clear any residual local state just in case
                 localStorage.clear();
                 // Continue to show login form...
                 return;
              }

              const { data: { session } } = await client.auth.getSession();
              if (session) {
                  // FORCE REFRESH: This is the critical fix.
                  // getUser() accepts valid stateless JWTs.
                  // refreshSession() requires a valid Refresh Token.
                  // If admin.signOut() revoked the Refresh Token, this call WILL fail.
                  const { data, error } = await client.auth.refreshSession();
                  
                  if (error || !data.session) {
                      // Session is invalid (e.g. revoked), force re-login
                      // console.log('Session refresh failed:', error);
                      await client.auth.signOut();
                      document.getElementById('auth-form-container').style.display = 'block';
                      document.getElementById('session-confirm-container').style.display = 'none';
                  } else {
                      document.getElementById('auth-form-container').style.display = 'none';
                      document.getElementById('session-confirm-container').style.display = 'block';
                      document.getElementById('user-welcome-text').innerText = 'Authenticated as ' + session.user.email;
                  }
              }
          }
          checkSession();

          async function authorizeCli() {
             const btn = document.getElementById('confirm-btn');
             btn.disabled = true;
             btn.innerText = 'Syncing...';
             
             const { data: { session } } = await client.auth.getSession();
             if (!session) {
                 location.reload();
                 return;
             }

             // Direct redirect with session tokens
             if ('${redirectUrl}') {
                 const target = '${redirectUrl}' + 
                     '?access_token=' + encodeURIComponent(session.access_token) + 
                     '&refresh_token=' + encodeURIComponent(session.refresh_token);
                 
                 showSimpleMessage('Session Synced. Redirecting...', 'success', 'confirm-message');
                 setTimeout(() => window.location.href = target, 500);
             } else {
                 showSimpleMessage('Identity Verified. Access Token: ' + session.access_token.substring(0, 10) + '...', 'success', 'confirm-message');
             }
          }

          async function switchAccount() {
              await client.auth.signOut();
              location.reload();
          }

          async function handleLogin() {
            const btn = document.getElementById('sign-in-btn');
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            btn.disabled = true;
            btn.innerText = 'Verifying...';
            
            if (!supabaseUrl) {
                setTimeout(() => {
                    redirectFn('dev-key-mock-12345');
                    btn.disabled = false;
                    btn.innerText = 'Sign In';
                }, 800);
                return;
            }

            if (password) {
                const { error } = await client.auth.signInWithPassword({ email, password });
                if (error) {
                    showSimpleMessage(error.message, 'error');
                    btn.disabled = false;
                    btn.innerText = 'Sign In';
                } else {
                    location.reload();
                }
            } else {
                showSimpleMessage('Sending Magic Link...', 'neutral');
                const { error } = await client.auth.signInWithOtp({
                    email,
                    options: { emailRedirectTo: window.location.href }
                });
                btn.disabled = false;
                btn.innerText = 'Sign In';
                if (error) {
                    showSimpleMessage(error.message, 'error');
                } else {
                    showSimpleMessage('Magic link sent. Check your email.', 'success');
                }
            }
          }
      </script>

    </body>
    </html>
  `;
};
