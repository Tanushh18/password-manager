import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useVault } from "../../state/vault";
import { ShieldLine, LockLine, KeyLine, Sparkle, Arrow, Check } from "../../Components/Icons/Icons";
import "./Home.css";

function Home() {
  const { status, profile, items } = useVault();
  const isAuthenticated = status === "ready" || status === "locked";
  const name = profile?.name;
  const passwords = status === "ready" ? items : profile ? { length: 0 } : [];
  const count = passwords?.length || 0;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(id);
  }, []);

  const firstName = (name || "").split(" ")[0];

  const features = [
    {
      icon: <ShieldLine size={24} />,
      title: "Zero-Knowledge Encryption",
      desc: "AES-256-GCM encryption. Your key, only you hold it.",
    },
    {
      icon: <Sparkle size={24} />,
      title: "Live Vault Health",
      desc: "Real-time scoring for weak, reused & breached passwords.",
    },
    {
      icon: <KeyLine size={24} />,
      title: "2FA & Authenticator",
      desc: "Store secrets & generate live codes next to logins.",
    },
  ];

  const steps = [
    { num: "01", title: "Create your vault", desc: "One account, one master password." },
    { num: "02", title: "Add your passwords", desc: "Seconds to save, searchable forever." },
    { num: "03", title: "Stay secure", desc: "Health score guides you to stronger passwords." },
  ];

  return (
    <div className="App home bg-white dark:bg-dark-bg">
      {/* HERO SECTION */}
      <section className="section bg-gradient-to-b from-white to-gray-50 dark:from-dark-bg dark:to-dark-surface pt-20 md:pt-32 pb-16 md:pb-24">
        <div className="container-max px-6 md:px-8">
          <div className={`grid grid-cols-1 lg:grid-cols-2 gap-16 items-center ${mounted ? "animate-fade-up" : "opacity-0"}`}>
            {/* Left side copy */}
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 rounded-full">
                <Sparkle size={14} className="text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                  {status === "ready" ? "Vault unlocked" : status === "locked" ? "Vault locked" : "Secure · Private · Free"}
                </span>
              </div>

              {isAuthenticated ? (
                <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white leading-tight">
                  Welcome back, <span className="italic text-purple-600 dark:text-purple-400">{firstName || "friend"}</span>
                </h1>
              ) : (
                <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white leading-tight">
                  Your passwords, <span className="italic text-purple-600 dark:text-purple-400">glowing and safe</span>
                </h1>
              )}

              <p className="text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
                {status === "locked" ? (
                  "Your vault is locked on this device. Unlock it with your master password to continue."
                ) : isAuthenticated ? (
                  count > 0 ? (
                    <>There are <strong>{count}</strong> passwords safely encrypted in your vault.</>
                  ) : (
                    "Your vault is empty. Add your first password and watch your health score light up."
                  )
                ) : (
                  "Stashr is a beautiful, private vault for your passwords. AES-256 encryption, real-time health scoring, and built-in 2FA support — on web and Android."
                )}
              </p>

              <div className="flex flex-wrap gap-3 pt-4">
                {isAuthenticated ? (
                  <>
                    <Link to="/passwords" className="btn btn-primary">
                      Open my vault
                      <Arrow size={16} />
                    </Link>
                    <Link to="/logout" className="btn btn-ghost">
                      Sign out
                    </Link>
                  </>
                ) : (
                  <>
                    <Link to="/signup" className="btn btn-primary">
                      Create your vault
                      <Arrow size={16} />
                    </Link>
                    <Link to="/signin" className="btn btn-ghost">
                      I already have one
                    </Link>
                  </>
                )}
              </div>

              <div className="pt-4 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <Sparkle size={14} />
                Free, forever. No credit card required.
              </div>
            </div>

            {/* Right side visual */}
            <div className="hidden lg:flex justify-center items-center">
              <div className="w-80 h-80 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 p-8 shadow-2xl flex flex-col items-center justify-center text-white space-y-6">
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                  <ShieldLine size={32} />
                </div>
                <div className="text-center space-y-2">
                  <div className="text-sm font-medium opacity-90">Your Vault</div>
                  <div className="text-2xl font-bold">{isAuthenticated ? `${firstName}'s Vault` : "Secure"}</div>
                </div>
                <div className="w-full space-y-3 pt-4 border-t border-white/20">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <KeyLine size={16} />
                      <div className="h-2 flex-1 bg-white/20 rounded"></div>
                      <LockLine size={16} />
                    </div>
                  ))}
                </div>
                <div className="text-xs opacity-75 pt-2">Encrypted just now</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES SECTION */}
      <section className="section py-16 md:py-24">
        <div className="container-max px-6 md:px-8">
          <div className="max-w-2xl mb-16">
            <span className="inline-block px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium mb-4">Why Stashr</span>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Security that <span className="italic">feels alive</span>
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Strong encryption, live insights, and a design you'll actually enjoy opening every day.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div key={i} className="card hover:shadow-primary cursor-pointer">
                <div className="w-12 h-12 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{feature.title}</h3>
                <p className="text-gray-600 dark:text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section py-16 md:py-24 bg-gray-50 dark:bg-dark-surface">
        <div className="container-max px-6 md:px-8">
          <div className="max-w-2xl mb-16">
            <span className="inline-block px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium mb-4">How it works</span>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Three steps to a <span className="italic">secure vault</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <div key={i} className="relative">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-purple-600 text-white font-bold">
                      {step.num}
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{step.title}</h3>
                    <p className="text-gray-600 dark:text-gray-400">{step.desc}</p>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-6 -right-4 w-8 h-1 bg-gradient-to-r from-purple-600 to-transparent"></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="section py-16 md:py-24">
        <div className="container-max px-6 md:px-8">
          <div className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-2xl p-12 md:p-16 text-center text-white space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold">
              Your whole digital life,
              <br />
              <span className="italic">one tap away</span>
            </h2>
            <p className="text-lg opacity-90 max-w-2xl mx-auto">
              Secure password management on every device. Encrypted. Private. Always free.
            </p>
            <div className="flex flex-wrap gap-3 justify-center pt-6">
              <Link to={isAuthenticated ? "/passwords" : "/signup"} className="btn btn-primary">
                {isAuthenticated ? "Open my vault" : "Begin your vault"}
                <Arrow size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES GRID */}
      <section className="section py-16 md:py-24 bg-gray-50 dark:bg-dark-surface">
        <div className="container-max px-6 md:px-8">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-12">Everything you need</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: "🔐", title: "AES-256 Encryption", desc: "Military-grade security" },
              { icon: "📊", title: "Health Score", desc: "Real-time security audit" },
              { icon: "🤖", title: "Auto-Generate", desc: "Strong password creation" },
              { icon: "📱", title: "Mobile Sync", desc: "Access everywhere" },
              { icon: "🔄", title: "Import/Export", desc: "Easy data migration" },
              { icon: "🎯", title: "Organize", desc: "Folders & favorites" },
              { icon: "🔍", title: "Search", desc: "Instant access" },
              { icon: "⚡", title: "Lightning Fast", desc: "Instant encryption" },
            ].map((feature, i) => (
              <div key={i} className="card text-center hover:shadow-primary">
                <div className="text-3xl mb-3">{feature.icon}</div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-1">{feature.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-900 dark:bg-black text-white py-12">
        <div className="container-max px-6 md:px-8 text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <ShieldLine size={20} />
            <span className="font-bold text-lg">Stashr</span>
          </div>
          <p className="text-gray-400 mb-6">Encrypted with AES-256 · Web & Android</p>
          <div className="flex flex-wrap gap-6 justify-center text-sm text-gray-400">
            <Link to="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <span>•</span>
            <a href="#" className="hover:text-white transition-colors">Security</a>
            <span>•</span>
            <a href="#" className="hover:text-white transition-colors">Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Home;
