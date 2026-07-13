import { useAuth } from '../contexts/AuthContext'
import { LoginPage } from './LoginPage'
export function ProtectedApp({children}){const {isLegacy,loading,session,profile}=useAuth();if(isLegacy)return children;if(loading)return <main className="login-page"><p>Validando acesso…</p></main>;if(!session||!profile)return <LoginPage/>;return children}
