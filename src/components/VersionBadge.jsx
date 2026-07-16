const version=import.meta.env.VITE_APP_VERSION||'0.0.0'
const commit=import.meta.env.VITE_GIT_COMMIT||'local'
const buildDate=import.meta.env.VITE_BUILD_DATE||'build local'
export function VersionBadge(){return <div className="version-badge" title={`Build: ${buildDate}`}>CRM {version} · {commit.slice(0,8)}</div>}
