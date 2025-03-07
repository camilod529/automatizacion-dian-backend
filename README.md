A continuación, se muestra un ejemplo de un README.md para tu proyecto NestJS:

---

# Backend API con NestJS

Este es un proyecto de backend desarrollado con [NestJS](https://nestjs.com/). La aplicación sirve como API y está preparada para entornos de desarrollo y producción.

## Tabla de Contenidos

- [Backend API con NestJS](#backend-api-con-nestjs)
  - [Tabla de Contenidos](#tabla-de-contenidos)
  - [Instalación](#instalación)
  - [Configuración](#configuración)
  - [Uso](#uso)
    - [En Desarrollo](#en-desarrollo)
    - [En Producción](#en-producción)
  - [Desarrollo](#desarrollo)
  - [Pruebas](#pruebas)
  - [Contribuciones](#contribuciones)

## Instalación

1. **Clona el repositorio:**

   ```bash
   git clone https://github.com/camilod529/automatizacion-dian-backend.git backend
   cd backend
   ```

2. **Instala las dependencias:**

   ```bash
   npm install
   ```

3. **Configura las variables de entorno:**

   Copia el archivo `.env.template` a `.env` y ajusta los valores según tus necesidades.

   ```bash
   cp .env.template .env
   ```

## Configuración

- **Variables de Entorno:**  
  El archivo `.env` contiene la configuración necesaria para la aplicación (puertos, claves, conexiones a bases de datos, etc.). Asegúrate de revisarlo y modificarlo de acuerdo con el entorno en el que se desplegará la aplicación.

- **Herramientas de Formateo y Linter:**  
  Se utilizan [Prettier](https://prettier.io/) y ESLint para mantener la calidad del código. La configuración se encuentra en `.prettierrc` y `eslint.config.mjs` respectivamente.

## Uso

### En Desarrollo

Para ejecutar la aplicación en modo desarrollo con recarga automática:

```bash
npm run start:dev
```

La aplicación se iniciará (por defecto en el puerto definido en `.env` o el predeterminado de NestJS) y podrás acceder a la API a través de `http://localhost:<PUERTO>`.

### En Producción

Para compilar el proyecto:

```bash
npm run build
```

Y luego iniciar la aplicación en modo producción:

```bash
npm run start:prod
```

## Desarrollo

Este proyecto utiliza [NestJS](https://nestjs.com/) y está estructurado siguiendo las mejores prácticas recomendadas por el framework. Se recomienda utilizar [Visual Studio Code](https://code.visualstudio.com/) y aprovechar la configuración incluida en la carpeta `.vscode`.

## Pruebas

- **Pruebas Unitarias:**  
  Ejecuta las pruebas unitarias con:

  ```bash
  npm run test
  ```

- **Pruebas End-to-End:**  
  Para ejecutar las pruebas E2E:

  ```bash
  npm run test:e2e
  ```

## Contribuciones

Las contribuciones son bienvenidas. Si deseas mejorar este proyecto, por favor sigue estos pasos:

1. Haz un fork del repositorio.
2. Crea una rama para tu nueva característica o corrección.
3. Realiza tus cambios y asegúrate de que las pruebas pasen.
4. Envía un Pull Request describiendo tus cambios.
