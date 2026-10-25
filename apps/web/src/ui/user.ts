import { createContext, useContext } from "react";
import type { CurrentUser } from "../api";

/** Quem está logado (o App só renderiza o resto depois do login) */
export const UserContext = createContext<CurrentUser | null>(null);

export const useCurrentUser = () => useContext(UserContext);
