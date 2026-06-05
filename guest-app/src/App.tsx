import { Route, Routes } from "react-router-dom";
import { BookingConfirmPage } from "./pages/BookingConfirmPage";
import { BookingLookupPage } from "./pages/BookingLookupPage";
import { BookingPage } from "./pages/BookingPage";
import { CorporateStaysPage } from "./pages/CorporateStaysPage";
import { HomePage } from "./pages/HomePage";
import { RoomsPage } from "./pages/RoomsPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/rooms" element={<RoomsPage />} />
      <Route path="/book" element={<BookingPage />} />
      <Route path="/book/confirm" element={<BookingConfirmPage />} />
      <Route path="/my-booking" element={<BookingLookupPage />} />
      <Route path="/corporate" element={<CorporateStaysPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}

