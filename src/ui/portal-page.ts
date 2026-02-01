
export const getPortalPageHtml = (data: {
    user: { id: string, email: string },
    credits: number,
    tier: string,
    transactions: any[],
    apiKeys: any[],
    config: any
}) => {
    const isPro = data.tier === 'pro';
    const tokens = {
        colors: {
            bg: '#0F172A',
            sidebar: '#1E293B',
            card: '#1E293B',
            cardForeground: '#F1F5F9',
            emerald: '#10B981',
            indigo: '#6366F1',
            purple: '#A855F7',
            textMuted: '#94A3B8',
            border: '#334155',
            error: '#EF4444'
        }
    };

    const transactionRows = data.transactions.map(tx => `
        <div class="activity-row">
            <span class="activity-date">${new Date(tx.created_at).toLocaleDateString()}</span>
            <span class="activity-desc">${tx.description}</span>
            <span class="activity-amount ${tx.amount > 0 ? 'plus' : 'minus'}">${tx.amount > 0 ? '+' : ''}${tx.amount}</span>
        </div>
    `).join('');

    const apiKeyRows = data.apiKeys.map(key => `
        <div class="key-row">
            <div class="key-info">
                <span class="key-name">${key.name || 'Unnamed Key'}</span>
                <span class="key-hash">${key.key_hash.substring(0, 12)}...</span>
            </div>
            <div class="key-meta">
                <span class="key-date">Added ${new Date(key.created_at).toLocaleDateString()}</span>
                <button class="btn-icon btn-danger" onclick="revokeKey('${key.id}')" title="Revoke Key">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>n8m | SaaS Portal</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
        <style>
            :root {
                --bg: ${tokens.colors.bg};
                --sidebar: ${tokens.colors.sidebar};
                --card: ${tokens.colors.card};
                --card-fg: ${tokens.colors.cardForeground};
                --emerald: ${tokens.colors.emerald};
                --indigo: ${tokens.colors.indigo};
                --purple: ${tokens.colors.purple};
                --text-muted: ${tokens.colors.textMuted};
                --border: ${tokens.colors.border};
                --error: ${tokens.colors.error};
                
                --sidebar-width: 260px;
                --header-height: 64px;
            }

            * { box-sizing: border-box; }
            
            body {
                margin: 0;
                background-color: var(--bg);
                color: var(--card-fg);
                font-family: 'Inter', sans-serif;
                display: flex;
                min-height: 100vh;
                overflow: hidden;
            }

            /* --- Sidebar --- */
            aside {
                width: var(--sidebar-width);
                background-color: var(--sidebar);
                border-right: 1px solid var(--border);
                display: flex;
                flex-direction: column;
                z-index: 10;
            }

            .logo-section {
                height: var(--header-height);
                display: flex;
                align-items: center;
                padding: 0 24px;
                gap: 12px;
                border-bottom: 1px solid var(--border);
            }

            .logo-box {
                width: 32px;
                height: 32px;
                background: rgba(16, 185, 129, 0.1);
                border: 1px solid var(--emerald);
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--emerald);
            }

            .logo-text {
                font-weight: 800;
                font-size: 18px;
                letter-spacing: -0.5px;
            }

            nav {
                flex-grow: 1;
                padding: 24px 12px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .nav-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                text-decoration: none;
                color: var(--text-muted);
                font-size: 14px;
                font-weight: 500;
                border-radius: 6px;
                transition: all 0.2s;
                cursor: pointer;
            }

            .nav-item:hover {
                background: rgba(255, 255, 255, 0.05);
                color: var(--card-fg);
            }

            .nav-item.active {
                background: rgba(16, 185, 129, 0.1);
                color: var(--emerald);
            }

            .sidebar-footer {
                padding: 16px;
                border-top: 1px solid var(--border);
                font-size: 12px;
            }

            .user-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .user-email {
                color: var(--card-fg);
                font-weight: 600;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .user-tier {
                color: var(--emerald);
                text-transform: uppercase;
                letter-spacing: 0.5px;
                font-size: 10px;
                font-weight: 700;
            }

            /* --- Main Content --- */
            main {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                height: 100vh;
                overflow-y: auto;
            }

            header {
                height: var(--header-height);
                min-height: var(--header-height);
                border-bottom: 1px solid var(--border);
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 40px;
                background: rgba(15, 23, 42, 0.8);
                backdrop-filter: blur(8px);
                position: sticky;
                top: 0;
                z-index: 5;
            }

            .page-title {
                font-size: 16px;
                font-weight: 600;
            }

            .header-actions {
                display: flex;
                align-items: center;
                gap: 16px;
            }

            .balance-pill {
                background: rgba(16, 185, 129, 0.1);
                border: 1px solid rgba(16, 185, 129, 0.2);
                padding: 6px 12px;
                border-radius: 999px;
                font-size: 13px;
                font-weight: 600;
                color: var(--emerald);
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .content-area {
                padding: 40px;
                max-width: 1000px;
                width: 100%;
                margin: 0 auto;
            }

            .section {
                display: none;
                animation: fade-in 0.3s ease;
            }

            .section.active {
                display: block;
            }

            @keyframes fade-in {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }

            /* --- Dashboard Cards --- */
            .grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 24px;
            }

            .card {
                background: var(--card);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 24px;
                display: flex;
                flex-direction: column;
                gap: 16px;
                position: relative;
                overflow: hidden;
            }

            .card h2 {
                margin: 0;
                font-size: 14px;
                color: var(--text-muted);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .card-value {
                font-size: 32px;
                font-weight: 700;
                color: var(--emerald);
            }

            /* --- Activity & Table Styling --- */
            .activity-list, .key-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .activity-row, .key-row {
                background: rgba(255, 255, 255, 0.02);
                border: 1px solid var(--border);
                border-radius: 8px;
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 14px;
            }

            .activity-date { color: var(--text-muted); width: 100px; }
            .activity-desc { flex-grow: 1; font-weight: 500; }
            .activity-amount.plus { color: var(--emerald); }
            .activity-amount.minus { color: var(--error); }

            .key-info { display: flex; flex-direction: column; gap: 4px; }
            .key-name { font-weight: 600; }
            .key-hash { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-muted); }
            .key-meta { display: flex; align-items: center; gap: 16px; }
            .key-date { font-size: 12px; color: var(--text-muted); }

            /* --- Buttons --- */
            .btn {
                padding: 10px 20px;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                border: none;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            .btn-primary { background: var(--emerald); color: var(--bg); }
            .btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }

            .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--card-fg); }
            .btn-secondary:hover { background: rgba(255, 255, 255, 0.05); }

            .btn-danger { color: var(--error); }
            .btn-danger:hover { background: rgba(239, 68, 68, 0.1); }

            .btn-icon {
                width: 32px;
                height: 32px;
                border-radius: 4px;
                padding: 0;
            }

            /* --- Billing Specific --- */
            .pricing-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 24px;
                margin-top: 24px;
            }

            .plan-card {
                background: rgba(255, 255, 255, 0.02);
                border: 2px solid var(--border);
                padding: 32px;
                border-radius: 16px;
                position: relative;
            }

            .plan-card.active { border-color: var(--emerald); }
            .plan-card h3 { margin: 0 0 8px; }
            .plan-price { font-size: 36px; font-weight: 800; margin-bottom: 24px; }
            .plan-price span { font-size: 16px; font-weight: 400; color: var(--text-muted); }

            ul.plan-features {
                list-style: none;
                padding: 0;
                margin: 0 0 32px;
                color: var(--text-muted);
                font-size: 14px;
            }

            ul.plan-features li { margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
            ul.plan-features li::before { content: '✓'; color: var(--emerald); font-weight: bold; }

        </style>
    </head>
    <body onload="initTab()">
        <aside>
            <div class="logo-section">
                <div class="logo-box">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
                    </svg>
                </div>
                <div class="logo-text">n8m Portal</div>
            </div>
            
            <nav>
                <div class="nav-item active" onclick="showSection('overview', this)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                    Overview
                </div>
                <div class="nav-item" onclick="showSection('billing', this)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>
                    Usage & Billing
                </div>
                <div class="nav-item" onclick="showSection('developer', this)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"></path><path d="M8 6l-6 6 6 6"></path></svg>
                    Developer API
                </div>
                
                <div style="flex-grow: 1;"></div>
                
                <a class="nav-item" href="/api/v1/auth/logout">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                    Sign Out
                </a>
            </nav>
            
            <div class="sidebar-footer">
                <div class="user-info">
                    <span class="user-email">${data.user.email}</span>
                    <span class="user-tier">${data.tier} Access</span>
                </div>
            </div>
        </aside>

        <main>
            <header>
                <div class="page-title" id="page-title">Dashboard Overview</div>
                <div class="header-actions">
                    <div class="balance-pill">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path><line x1="12" y1="18" x2="12" y2="20"></line><line x1="12" y1="4" x2="12" y2="6"></line></svg>
                        ${data.credits} Credits
                    </div>
                    <button class="btn btn-primary" onclick="showSection('billing')">Buy Credits</button>
                </div>
            </header>

            <div class="content-area">
                
                <!-- Section: Overview -->
                <div id="overview" class="section active">
                    <h1 style="margin-top:0">Project Statistics</h1>
                    <div class="grid">
                        <div class="card">
                            <h2>Compute Remaining</h2>
                            <div class="card-value">${data.credits} <span style="font-size:14px; color:var(--text-muted); font-weight:400">Tokens</span></div>
                        </div>
                        <div class="card">
                            <h2>Subscription</h2>
                            <div class="card-value" style="color:var(--indigo)">${data.tier.toUpperCase()}</div>
                        </div>
                        <div class="card">
                            <h2>Active Keys</h2>
                            <div class="card-value" style="color:var(--purple)">${data.apiKeys.length}</div>
                        </div>
                    </div>
                    
                    <h2 style="margin-top:40px; font-size:18px">Recent Activity</h2>
                    <div class="activity-list">
                        ${transactionRows || '<div style="color: var(--text-muted)">No recent transactions found.</div>'}
                    </div>
                </div>

                <!-- Section: Billing -->
                <div id="billing" class="section">
                    <h1 style="margin-top:0">Resource Management</h1>
                    <p style="color:var(--text-muted)">Manage your subscription and top up credits for AI operations.</p>
                    
                    <div class="pricing-grid">
                        <div class="plan-card ${!isPro ? 'active' : ''}">
                            <h3>Free Edition</h3>
                            <div class="plan-price">$0<span>/mo</span></div>
                            <ul class="plan-features">
                                <li>10 Monthly Credits</li>
                                <li>Basic AI Assistance</li>
                                <li>Public Support</li>
                            </ul>
                            <button class="btn btn-secondary" style="width:100%" disabled>${!isPro ? 'Current Plan' : 'Standard'}</button>
                        </div>

                        <div class="plan-card ${isPro ? 'active' : ''}">
                            <h3>Pro Edition</h3>
                            <div class="plan-price">$20<span>/mo</span></div>
                            <ul class="plan-features">
                                <li>100 Monthly Credits</li>
                                <li>Priority Gemini Access</li>
                                <li>CLI Enterprise Sync</li>
                            </ul>
                            <button class="btn btn-primary" style="width:100%" id="btn-pro" onclick="checkout('${data.config.prices.pro}')">
                                ${isPro ? 'Manage Billing' : 'Upgrade Now'}
                            </button>
                        </div>
                    </div>

                    <div style="margin-top:48px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:24px; border-radius:12px; border:1px solid var(--border)">
                        <div>
                            <h3 style="margin:0">Quick Top-up</h3>
                            <p style="margin:4px 0 0; color:var(--text-muted); font-size:14px">Add 50 credits to your balance immediately.</p>
                        </div>
                        <button class="btn btn-primary" onclick="checkout('${data.config.prices.topup_50}')">Buy 50 Credits ($5)</button>
                    </div>
                </div>

                <!-- Section: Developer API -->
                <div id="developer" class="section">
                    <h1 style="margin-top:0">API Access</h1>
                    <p style="color:var(--text-muted)">Manage persistent keys for CI/CD and automation scripts.</p>
                    
                    <div style="margin-bottom: 32px">
                        <button class="btn btn-primary" onclick="alert('Use the CLI to create new keys: n8m login')">
                            How to create a key?
                        </button>
                    </div>

                    <h2 style="font-size:18px">Active API Keys</h2>
                    <div class="key-list">
                        ${apiKeyRows || '<div style="color: var(--text-muted)">No API keys active. Run <code>n8m login</code> to authenticate.</div>'}
                    </div>
                </div>

            </div>
        </main>

        <script>
            function showSection(id, el) {
                // Update nav state
                if (el) {
                    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
                    el.classList.add('active');
                }

                // Update section visibility
                document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
                document.getElementById(id).classList.add('active');

                // Update title
                const titles = {
                    'overview': 'Dashboard Overview',
                    'billing': 'Resource Management',
                    'developer': 'Developer API'
                };
                document.getElementById('page-title').innerText = titles[id];
                
                // Update URL hash without jumping
                history.replaceState(null, null, '#' + id);
            }

            function initTab() {
                const hash = window.location.hash.substring(1);
                if (hash && document.getElementById(hash)) {
                    showSection(hash, Array.from(document.querySelectorAll('.nav-item')).find(n => n.innerText.toLowerCase().includes(hash.toLowerCase().substring(0,3))));
                }
            }

            async function checkout(priceId) {
                const btn = event.target;
                const originalText = btn.innerText;
                btn.innerText = 'Redirecting...';
                btn.disabled = true;

                try {
                    const response = await fetch('/api/v1/billing/checkout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ priceId })
                    });
                    const data = await response.json();
                    if (data.url) {
                        window.location.href = data.url;
                    } else {
                        alert('Error: ' + (data.error || 'Failed to initiate checkout'));
                    }
                } catch (err) {
                    alert('Checkout failed: ' + err.message);
                } finally {
                    btn.innerText = originalText;
                    btn.disabled = false;
                }
            }

            async function revokeKey(keyId) {
                if (!confirm('Are you sure you want to revoke this API key? Any CLI instances using it will stop working.')) return;
                
                try {
                    const response = await fetch(\`/api/v1/billing/keys/\${keyId}\`, {
                        method: 'DELETE'
                    });
                    const data = await response.json();
                    if (data.success) {
                        location.reload();
                    } else {
                        alert('Error: ' + (data.error || 'Failed to revoke key'));
                    }
                } catch (err) {
                    alert('Revocation failed: ' + err.message);
                }
            }
        </script>
    </body>
    </html>
    `;
};
