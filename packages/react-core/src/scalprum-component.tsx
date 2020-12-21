import React, { Fragment, useEffect, Suspense, useState, ReactNode } from 'react';
import { getApp, getAppData, injectScript, processManifest } from '@scalprum/core';
import { loadComponent } from './async-loader';

export type ScalprumComponentProps<API = Record<string, unknown>, Props = Record<string, unknown>> = Props & {
  fallback?: NonNullable<React.ReactNode> | null;
  appName: string;
  api?: API;
  scope: string;
  module: string;
  ErrorComponent?: ReactNode;
  LoadingComponent?: React.ComponentType;
  innerRef?: React.Ref<unknown>;
  processor?: (item: any) => string;
};

const DefaultComponent: React.ComponentType = () => <Fragment />;

const DefaultErrorComponent: React.ComponentType = () => <span>Error while loading component!</span>;

const LoadModule: React.ComponentType<ScalprumComponentProps & { ErrorComponent: React.ComponentType }> = ({
  fallback = 'loading',
  appName,
  api,
  scope,
  module,
  ErrorComponent,
  processor,
  LoadingComponent = DefaultComponent,
  innerRef,
  ...props
}) => {
  const { scriptLocation, manifestLocation } = getAppData(appName);
  const [Component, setComponent] = useState<React.ComponentType<{ ref?: React.Ref<unknown> }>>(() => () => <LoadingComponent />);
  const [mountedAt, setMountedAt] = useState<HTMLScriptElement | HTMLScriptElement[] | undefined>();
  useEffect(() => {
    const app = getApp(appName);

    if (!app) {
      if (scriptLocation) {
        injectScript(appName, scriptLocation)
          .then(([, scriptMountedAt]) => {
            const app = getApp(appName);
            app?.mount<JSX.Element>(api);
            setComponent(() => React.lazy(loadComponent(scope, module, ErrorComponent)));
            setMountedAt(() => scriptMountedAt);
          })
          .catch(() => {
            setComponent(() => ErrorComponent);
          });
      } else if (manifestLocation) {
        processManifest(manifestLocation, appName, scope, processor)
          .then((items) => {
            setMountedAt(() => items.map((value) => (value as [unknown, HTMLScriptElement])[1]));
            const app = getApp(appName);
            app?.mount<JSX.Element>(api);
            setComponent(() => React.lazy(loadComponent(scope, module, ErrorComponent)));
          })
          .catch(() => {
            setComponent(() => ErrorComponent);
          });
      }
    } else {
      app?.mount<JSX.Element>(api);
      setComponent(() => React.lazy(loadComponent(scope, module, ErrorComponent)));
    }
    return () => {
      const app = getApp(appName);
      app?.unmount();
      if (mountedAt) {
        Array.isArray(mountedAt) ? mountedAt.forEach((mounted) => document.body.removeChild(mounted)) : document.body.removeChild(mountedAt);
      }
    };
  }, []);

  return (
    <Suspense fallback={fallback}>
      <Component ref={innerRef} {...props} />
    </Suspense>
  );
};

class BaseScalprumComponent extends React.Component<ScalprumComponentProps, { hasError: boolean }> {
  static defaultProps = {
    ErrorComponent: <DefaultErrorComponent />,
  };
  constructor(props: ScalprumComponentProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render(): ReactNode {
    const { ErrorComponent = <DefaultErrorComponent />, ...props } = this.props;

    if (this.state.hasError) {
      return ErrorComponent;
    }

    return <LoadModule {...props} ErrorComponent={() => <Fragment>{ErrorComponent}</Fragment>} />;
  }
}

export const ScalprumComponent: React.ComponentType<ScalprumComponentProps> = React.forwardRef((props, ref) => (
  <BaseScalprumComponent {...props} innerRef={ref} />
));