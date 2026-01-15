import React, { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { MemoryRouter, MemoryRouterProps } from "react-router-dom";

interface WrapperProps {
  children: React.ReactNode;
}

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  routerProps?: MemoryRouterProps;
}

const createWrapper = (routerProps?: MemoryRouterProps) => {
  const AllTheProviders = ({ children }: WrapperProps) => {
    return <MemoryRouter {...routerProps}>{children}</MemoryRouter>;
  };
  return AllTheProviders;
};

const customRender = (ui: ReactElement, options?: CustomRenderOptions) => {
  const { routerProps, ...renderOptions } = options || {};
  return render(ui, { wrapper: createWrapper(routerProps), ...renderOptions });
};

export * from "@testing-library/react";
export { customRender as render };
