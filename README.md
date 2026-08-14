# Entre Amigos v6

Aplicación web para administrar gastos compartidos entre distintos grupos.

## Tecnologías

- Frontend: HTML, CSS y JavaScript
- Backend: Node.js + Express
- Base de datos: MariaDB / MySQL

## Funcionalidades

- Múltiples grupos.
- Una misma persona puede pertenecer a varios grupos.
- Personas editables.
- Atributos opcionales:
  - apellido
  - teléfono
  - alias bancario
- Registro de gastos con uno o varios pagadores.
- División igual por defecto.
- División personalizada opcional.
- Cálculo exacto al centavo.
- Simplificación opcional de deudas.
- Registro de transferencias.
- Saldos explicados mostrando:
  - cuánto aportó
  - cuánto consumió
  - transferencias enviadas
  - transferencias recibidas
  - saldo pendiente
- Buscador de movimientos.
- Informes por período.
- Informes por persona.
- Resumen formal para compartir por WhatsApp.
- Botón para copiar el resumen.
- El resumen compartible incluye:
  - gastos
  - quién pagó
  - participantes
  - importes asignados
  - saldos
  - cómo saldar las deudas
  - alias bancario del receptor cuando está cargado

## Instalación

1. Ejecutar `modelo.sql` en MariaDB.
2. Revisar `db.js` y modificar usuario/contraseña si hace falta.
3. Ejecutar:

```bash
npm install
npm start
```

4. Abrir:

http://localhost:3000

## Importante

Esta versión cambia el modelo de datos respecto de las versiones anteriores.
Para una prueba limpia, ejecutar nuevamente `modelo.sql`.