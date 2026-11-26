// The company logo. Light theme: the logo as supplied on a white plate. Dark theme: a light-coloured copy of it
// (navy letters white, grey letters light grey, triangles unchanged) straight on the dark background, no white box.
import logo from '../assets/altiusnxt-logo.png';
import logoDark from '../assets/altiusnxt-logo-dark.png';

export default function Logo({ className = '' }) {
  return (
    <span className={`logo-plate ${className}`}>
      <img className="logo-l" src={logo} alt="AltiusNxt" width="640" height="172" />
      <img className="logo-d" src={logoDark} alt="AltiusNxt" width="640" height="172" />
    </span>
  );
}
