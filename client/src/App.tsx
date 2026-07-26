import DailyIntro from "./components/DailyIntro";
import AdminPage from "./pages/AdminPage";
import FrontPage from "./pages/FrontPage";
import { AppTimeZoneProvider } from "./timeZone";

export default function App() {
  return (
    <AppTimeZoneProvider>
      {window.location.pathname.startsWith("/admin") ? (
        <AdminPage />
      ) : (
        <>
          <DailyIntro />
          <FrontPage />
        </>
      )}
    </AppTimeZoneProvider>
  );
}
