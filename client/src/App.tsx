import AdminPage from "./pages/AdminPage";
import FrontPage from "./pages/FrontPage";

export default function App() {
  return window.location.pathname.startsWith("/admin") ? <AdminPage /> : <FrontPage />;
}
