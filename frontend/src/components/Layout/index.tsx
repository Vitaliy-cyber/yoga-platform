import React from "react";
import { Outlet } from "react-router-dom";

export const Layout: React.FC = () => {
  return (
    <div className="min-h-screen bg-stone-50">
      <Outlet />
    </div>
  );
};
