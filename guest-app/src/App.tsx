import { Route, Routes } from "react-router-dom";
import { BookingConfirmPage } from "./pages/BookingConfirmPage";
import { BookingLookupPage } from "./pages/BookingLookupPage";
import { BookingPage } from "./pages/BookingPage";
import { CorporateBookingPage } from "./pages/CorporateBookingPage";
import { CorporateStaysPage } from "./pages/CorporateStaysPage";
import { HomePage } from "./pages/HomePage";
import { RewardsLandingPage } from "./pages/RewardsLandingPage";
import { RoomsPage } from "./pages/RoomsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/rooms" element={<RoomsPage />} />
      <Route path="/book" element={<BookingPage />} />
      <Route path="/book/confirm" element={<BookingConfirmPage />} />
      <Route path="/my-booking" element={<BookingLookupPage />} />
      <Route path="/corporate" element={<CorporateStaysPage />} />
      <Route path="/corporate/book" element={<CorporateBookingPage />} />
      <Route path="/rewards" element={<RewardsLandingPage />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}




