import { createContext, useContext } from 'react';
export const AuthCtx = createContext(null);
/** { user: {id,name,username,role}, can('upload'|'undoUpload'|'report'|'settings'|'users'), refresh() } */
export const useAuth = () => useContext(AuthCtx);
