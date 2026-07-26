import AdminPage from "./pages/AdminPage";
import FrontPage from "./pages/FrontPage";
import { AppTimeZoneProvider } from "./timeZone";

export default function App() {
  return (
    <AppTimeZoneProvider>
      {window.location.pathname.startsWith("/admin") ? (
        <AdminPage />
      ) : (
        <FrontPage />
      )}
    </AppTimeZoneProvider>
  );
}
