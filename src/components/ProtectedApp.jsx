import { useAuth } from '../contexts/AuthContext'
import { LoginPage } from './LoginPage'
import { BrandLoading } from './BrandLoading'
export function ProtectedApp({children}){const {isLegacy,loading,session,profile}=useAuth();if(isLegacy)return children;if(loading)return <BrandLoading/>;if(!session||!profile)return <LoginPage/>;return children}
