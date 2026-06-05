import { Route, Routes } from "react-router-dom";
import { AboutPage } from "./pages/AboutPage";
import { BookingConfirmPage } from "./pages/BookingConfirmPage";
import { BookingLookupPage } from "./pages/BookingLookupPage";
import { BookingPage } from "./pages/BookingPage";
import { ContactPage } from "./pages/ContactPage";
import { CorporateBookingPage } from "./pages/CorporateBookingPage";
import { CorporateStaysPage } from "./pages/CorporateStaysPage";
import { HomePage } from "./pages/HomePage";
import { IntercomPage } from "./pages/IntercomPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { ProfilePage } from "./pages/ProfilePage";
import { RewardsPage } from "./pages/RewardsPage";
import { RewardsLandingPage } from "./pages/RewardsLandingPage";
import { RoomsPage } from "./pages/RoomsPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { StaysPage } from "./pages/StaysPage";

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
      <Route path="/account/profile" element={<ProfilePage />} />
      <Route path="/account/stays" element={<StaysPage />} />
      <Route path="/account/rewards" element={<RewardsPage />} />
      <Route path="/intercom/:roomId" element={<IntercomPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}





