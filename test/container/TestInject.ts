import { expect } from 'chai';
import { ineeda } from 'ineeda';
import { spy } from 'sinon';

import { NullLogger, Provides } from '../../src';
import { BaseOptions, Container, Contract } from '../../src/Container';
import { BaseError } from '../../src/error/BaseError';
import { MissingValueError } from '../../src/error/MissingValueError';
import { Inject } from '../../src/Inject';
import { Module, ModuleOptions } from '../../src/Module';
import { isNil } from '../../src/utils';
import { Consumer, Implementation, Interface, TestModule } from '../HelperClass';
import { describeLeaks, itLeaks } from '../helpers/async';
import { getTestLogger } from '../helpers/logger';

/* eslint-disable no-null/no-null, @typescript-eslint/no-explicit-any, @typescript-eslint/unbound-method */

describeLeaks('container', async () => {
  itLeaks('should throw when no contract was passed', async () => {
    const container = Container.from();
    await container.configure();

    await expect(container.create(null as any)).to.be.rejectedWith(BaseError);
  });

  itLeaks('should provide injected dependencies', async () => {
    const ctorSpy = spy();
    const instance = {};

    class FooClass { /* noop */ }

    @Inject(FooClass)
    class TestClass {
      constructor(...args: Array<any>) {
        ctorSpy(...args);
      }
    }

    class FooModule extends Module {
      public async configure(options: ModuleOptions) {
        this.bind(FooClass).toInstance(instance);
      }
    }

    const module = new FooModule();
    const container = Container.from(module);
    await container.configure();
    await container.create(TestClass);

    expect(ctorSpy).to.have.been.called.callCount(1);
    expect(ctorSpy).to.have.been.calledWithExactly({
      container,
      [FooClass.name]: instance,
    });
  });

  itLeaks('should inject named dependencies', async () => {
    interface FooOptions extends BaseOptions {
      foo: FooClass;
    }
    class FooClass { /* noop */ }

    @Inject({ contract: FooClass, name: 'foo' })
    class TestClass {
      public readonly foo: FooClass;

      constructor(options: FooOptions) {
        this.foo = options.foo;
      }
    }

    class FooModule extends Module {
      public async configure(options: ModuleOptions) {
        this.bind(FooClass).toConstructor(FooClass);
      }
    }

    const module = new FooModule();
    const container = Container.from(module);
    await container.configure();

    const injected = await container.create(TestClass);
    expect(injected.foo).to.be.an.instanceof(FooClass);
  });

  itLeaks('should pass arguments to the constructor', async () => {
    const ctr = Container.from(new TestModule());
    await ctr.configure();

    const args = ['a', 'b', 'c'];
    const impl = await ctr.create(Consumer, {}, ...args);
    expect(impl.args).to.deep.equal(args);
  });

  itLeaks('should pass typed arguments to the constructor', async () => {
    const ctr = Container.from(new TestModule());
    await ctr.configure();

    const args = ['a', 'b', 'c'];
    class TypedConsumer {
      public readonly others: Array<string>;

      constructor(options: BaseOptions, ...others: Array<string>) {
        this.others = others;
      }
    }

    const impl = await ctr.create(TypedConsumer, {}, ...args);
    expect(impl.others).to.deep.equal(args);
  });

  itLeaks('should call provider methods', async () => {
    const modSpy = spy();

    class SubModule extends Module {
      @Provides(Interface)
      public async create() {
        modSpy();

        if (isNil(this.container)) {
          throw new Error('missing container');
        } else {
          return this.container.create(Implementation);
        }
      }
    }

    const mod = new SubModule();
    const ctr = Container.from(mod);
    await ctr.configure();

    const impl = await ctr.create(Consumer);
    expect(modSpy).to.have.been.called.callCount(1);
    expect(impl.deps[Interface.name]).to.be.an.instanceof(Implementation);
  });

  itLeaks('should call provider methods with dependencies', async () => {
    class Outerface { /* empty */ }
    const outerInstance = new Outerface();

    const modSpy = spy();
    class SubModule extends Module {
      public async configure(options: ModuleOptions) {
        await super.configure(options);
        this.bind(Outerface).toInstance(outerInstance);
      }

      @Inject(Outerface)
      @Provides(Interface)
      public async create(outer: { outerface: Outerface }) {
        if (this.logger !== undefined) {
          this.logger.debug({ outer }, 'submodule create');
        }

        modSpy(outer);
        if (isNil(this.container)) {
          throw new Error('missing container');
        } else {
          return this.container.create(Implementation, outer as any);
        }

      }
    }

    const ctr = Container.from(new SubModule());
    await ctr.configure();

    const impl = await ctr.create(Consumer);

    expect(modSpy).to.have.been.called.callCount(1);
    expect(impl.deps[Interface.name]).to.be.an.instanceOf(Implementation);
    expect(impl.deps[Interface.name].deps[Outerface.name]).to.equal(outerInstance);
  });

  itLeaks('should call bound factories', async () => {
    let counter = 0;

    class SubModule extends Module {
      public async configure() {
        this.bind(Interface).toFactory(async (deps: any, ...args: Array<any>) => {
          counter += 1;
          return new Implementation(deps, ...args);
        });
      }
    }

    const ctr = Container.from(new SubModule());
    await ctr.configure();

    const impl = await ctr.create(Consumer);

    expect(impl.deps[Interface.name]).to.be.an.instanceof(Implementation);
    expect(counter).to.equal(1);
  });

  itLeaks('should return bound instances', async () => {
    const name = 'foobar';
    const inst = {};

    class SubModule extends Module {
      public async configure() {
        this.bind(name).toInstance(inst);
      }
    }

    const ctr = Container.from(new SubModule());
    await ctr.configure();

    @Inject(name)
    class NameConsumer {
      public deps: any;

      constructor(deps: any) {
        this.deps = deps;
      }
    }

    const impl = await ctr.create(NameConsumer);
    expect(impl.deps[name]).to.equal(inst);
  });

  itLeaks('should invoke constructors', async () => {
    class Other { }
    class SubModule extends Module {
      public async configure() {
        this.bind(Interface).toConstructor(Implementation);
      }
    }

    const ctr = Container.from(new SubModule());
    await ctr.configure();

    const impl = await ctr.create(Interface);
    expect(impl).to.be.an.instanceof(Implementation);

    const other = await ctr.create(Other);
    expect(other).to.be.an.instanceof(Other);
  });

  itLeaks('should invoke factories', async () => {
    class SubModule extends Module {
      public async createInterface(deps: any, ...args: Array<any>) {
        return new Implementation(deps, ...args);
      }

      public async configure() {
        this.bind(Interface).toFactory((deps: any, ...args: Array<any>) => this.createInterface(deps, ...args));
      }
    }

    const ctr = Container.from(new SubModule());
    await ctr.configure();

    const impl = await ctr.create(Interface);
    expect(impl).to.be.an.instanceof(Implementation);
  });

  itLeaks('should not look up dependencies passed in options', async () => {
    @Inject('foo', 'bar')
    class TestClass {
      public foo: any;
      public bar: any;

      constructor(options: any) {
        this.foo = options.foo;
        this.bar = options.bar;
      }
    }

    const foo = {};
    class FooModule extends Module {
      public async configure(options: ModuleOptions) {
        this.bind('foo').toInstance(foo);
      }
    }

    const module = new FooModule();
    module.has = spy(module.has) as (contract: Contract<any, any>) => boolean;

    const container = Container.from(module);
    await container.configure();

    const bar = {};
    const injected = await container.create(TestClass, {
      bar,
    });

    expect(module.has).to.have.been.calledWith('foo');
    expect(module.has).not.to.have.been.calledWith('bar');
    expect(module.has, 'called for injected and foo').to.have.callCount(2);

    expect(injected.bar).to.equal(bar);
    expect(injected.foo).to.equal(foo);
  });

  itLeaks('should inject a dependency into a factory method', async () => {
    const ctr = Container.from(new TestModule());
    await ctr.configure();

    const impl = await ctr.create(Consumer, {}, 3);
    expect(impl.args).to.deep.equal([3]);
    expect(impl.deps[Interface.name]).to.be.an.instanceof(Implementation);
  });

  itLeaks('should throw on missing dependencies', async () => {
    // TestModule does not provide outerface
    const ctr = Container.from(new TestModule());
    await ctr.configure();

    @Inject('outerface')
    class FailingConsumer {
      private readonly di: any;

      constructor(di: any) {
        this.di = di;
      }
    }

    return expect(ctr.create(FailingConsumer)).to.eventually.be.rejectedWith(MissingValueError);
  });

  itLeaks('should resolve dependencies by contract', async () => {
    const foo = {};
    const fooSymbol = Symbol('foo');
    class FooModule extends Module {
      @Provides(fooSymbol)
      public async createFoo() {
        return foo;
      }
    }

    const logger = getTestLogger();
    spy(logger, 'debug');

    const module = new FooModule();
    const container = Container.from(module);
    await container.configure({
      logger,
    });

    expect(await container.create(fooSymbol)).to.equal(foo);
  });

  itLeaks('should fail and throw with a logger', async () => {
    @Inject('foo')
    class Bar {}

    const container = Container.from();
    await container.configure({
      logger: NullLogger.global,
    });

    const module = ineeda<Module>({
      get(contract: Contract<unknown, BaseOptions>) {
        return undefined;
      }
    });

    return expect(container.provide(module, Bar, {}, [])).to.eventually.be.rejectedWith(MissingValueError);
  });
});
