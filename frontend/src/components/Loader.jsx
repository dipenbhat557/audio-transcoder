import React from 'react';
import { BiLoader } from 'react-icons/bi';

const Loader = () => {
  return (
    <div className="flex items-center gap-2 text-blue-400">
      <BiLoader className="w-5 h-5 animate-spin" />
      <span>Processing recording...</span>
    </div>
  );
};

export default Loader; 