import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { Analytics } from "./components/Analytics";
import { PageMeta } from "./components/PageMeta";
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
    <>
      <Analytics />
      <Routes>
        <Route
          path="/"
          element={
            <WithMeta title="spark inn" description="Book a peaceful, consistent boutique hotel stay in Bohol.">
              <HomePage />
            </WithMeta>
          }
        />
        <Route
          path="/rooms"
          element={
            <WithMeta title="Rooms" description="Explore room options, amenities, and direct booking rates at spark inn.">
              <RoomsPage />
            </WithMeta>
          }
        />
        <Route
          path="/book"
          element={
            <WithMeta title="Book a Stay" description="Choose dates, select a room, and review your direct booking at spark inn." noIndex>
              <BookingPage />
            </WithMeta>
          }
        />
        <Route
          path="/book/confirm"
          element={
            <WithMeta title="Booking Confirmation" description="Review your spark inn booking confirmation and next steps." noIndex>
              <BookingConfirmPage />
            </WithMeta>
          }
        />
        <Route
          path="/my-booking"
          element={
            <WithMeta title="My Booking" description="Look up your spark inn reservation using your booking reference and email." noIndex>
              <BookingLookupPage />
            </WithMeta>
          }
        />
        <Route
          path="/corporate"
          element={
            <WithMeta title="Corporate Stays" description="Corporate room blocks and business stays in Tagbilaran City, Bohol.">
              <CorporateStaysPage />
            </WithMeta>
          }
        />
        <Route
          path="/corporate/book"
          element={
            <WithMeta title="Corporate Booking" description="Access negotiated corporate rates or continue with flat business rates." noIndex>
              <CorporateBookingPage />
            </WithMeta>
          }
        />
        <Route
          path="/rewards"
          element={
            <WithMeta title="Spark Rewards" description="Join Spark Rewards and earn member perks on future spark inn stays.">
              <RewardsLandingPage />
            </WithMeta>
          }
        />
        <Route
          path="/signin"
          element={
            <WithMeta title="Sign In" description="Sign in to your spark inn account." noIndex>
              <SignInPage />
            </WithMeta>
          }
        />
        <Route
          path="/signup"
          element={
            <WithMeta title="Sign Up" description="Create your spark inn guest account." noIndex>
              <SignUpPage />
            </WithMeta>
          }
        />
        <Route
          path="/account/profile"
          element={
            <WithMeta title="Profile" description="Manage your spark inn guest profile." noIndex>
              <ProfilePage />
            </WithMeta>
          }
        />
        <Route
          path="/account/stays"
          element={
            <WithMeta title="My Stays" description="Review your previous and upcoming spark inn stays." noIndex>
              <StaysPage />
            </WithMeta>
          }
        />
        <Route
          path="/account/rewards"
          element={
            <WithMeta title="My Rewards" description="Track your Spark Rewards points and member perks." noIndex>
              <RewardsPage />
            </WithMeta>
          }
        />
        <Route
          path="/intercom/:roomId"
          element={
            <WithMeta title="Guest Intercom" description="Request front desk help from your room." noIndex>
              <IntercomPage />
            </WithMeta>
          }
        />
        <Route
          path="/about"
          element={
            <WithMeta title="About Us" description="Learn the story, mission, and hospitality promise behind spark inn.">
              <AboutPage />
            </WithMeta>
          }
        />
        <Route
          path="/contact"
          element={
            <WithMeta title="Contact Us" description="Find spark inn contact details, address, and map location in Tagbilaran City.">
              <ContactPage />
            </WithMeta>
          }
        />
        <Route
          path="/privacy"
          element={
            <WithMeta title="Privacy Policy" description="Read how spark inn handles guest personal data and privacy rights.">
              <PrivacyPage />
            </WithMeta>
          }
        />
        <Route
          path="*"
          element={
            <WithMeta title="Page Not Found" description="This spark inn page could not be found." noIndex>
              <NotFoundPage />
            </WithMeta>
          }
        />
      </Routes>
    </>
  );
}

interface WithMetaProps {
  children: ReactNode;
  description: string;
  noIndex?: boolean;
  title: string;
}

function WithMeta({ children, description, noIndex, title }: WithMetaProps) {
  return (
    <>
      <PageMeta title={title} description={description} noIndex={noIndex} />
      {children}
    </>
  );
}
