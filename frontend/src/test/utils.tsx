import React, { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { MemoryRouter, MemoryRouterProps } from "react-router-dom";
import { I18nProvider } from "../i18n";

interface WrapperProps {
  children: React.ReactNode;
}

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  routerProps?: MemoryRouterProps;
}

const createWrapper = (routerProps?: MemoryRouterProps) => {
  const AllTheProviders = ({ children }: WrapperProps) => {
    return (
      <I18nProvider>
        <MemoryRouter {...routerProps}>{children}</MemoryRouter>
      </I18nProvider>
    );
  };
  return AllTheProviders;
};

const customRender = (ui: ReactElement, options?: CustomRenderOptions) => {
  const { routerProps, ...renderOptions } = options || {};
  return render(ui, { wrapper: createWrapper(routerProps), ...renderOptions });
};

export * from "@testing-library/react";
export { customRender as render };
